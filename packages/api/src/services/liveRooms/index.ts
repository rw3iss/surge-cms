/**
 * Live rooms (live-show posts) — REST side. The socket lives in `server.ts`
 * (attached in lib.ts); this barrel serves `GET /posts/:id/live`,
 * `POST /posts/:id/live/ticket`, and the staff viewer list + moderation
 * (`GET /posts/:id/live/viewers`, `POST /posts/:id/live/moderate`).
 */
import type {
    LiveBan, LiveModerateBody, LiveModerationAction, LiveModerationState, LiveRoomState, LiveServerEvent, LiveViewer, PostLiveTicketResponse, User,
} from '@sitesurge/types';
import { isStaffRole, LIVE_SILENCE_MIN_MINUTES, } from '@sitesurge/types';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { requirePermission, } from '../permissions';
import { isHost, viewAccess, } from './access';
import * as mod from './moderation';
import { notifyViewer, } from './server';
import { effectiveStatus, loadLivePost, toState, } from './state';
import * as store from './store';
import { createTicket, } from './tickets';

export { createTicket, verifyTicket, TICKET_TTL_SEC, } from './tickets';

async function requireViewable(postId: string, user: User | undefined,) {
    const row = await loadLivePost(postId,);
    const access = await viewAccess(row, user,);
    if (access === 'not_found' || !row) throw new NotFoundError('Live show',);
    if (access === 'unauthorized') throw new UnauthorizedError('Sign in to watch this show',);
    if (access === 'forbidden') throw new ForbiddenError('This show is for subscribers',);
    return row;
}

/** GET /posts/:id/live */
export async function getState(postId: string, user: User | undefined,): Promise<LiveRoomState> {
    const row = await requireViewable(postId, user,);
    return toState(row, await store.totalViewers(row.id,),);
}

/** POST /posts/:id/live/ticket — 409 once the show has ended. */
export async function issueTicketFor(postId: string, user: User | undefined,): Promise<PostLiveTicketResponse> {
    const row = await requireViewable(postId, user,);
    if (effectiveStatus(row,) === 'ended') throw new ConflictError('This show has ended', { code: 'ended', },);
    const userId = user?.id ?? null;
    const { token, expiresAt, } = createTicket(row.id, userId,);
    return { token, expiresAt, userId, isHost: await isHost(user,), };
}

// ─── Viewers + moderation (staff) ────────────────────────────────

async function requireModerator(user: User | undefined,): Promise<void> {
    if (!user) throw new UnauthorizedError();
    await requirePermission({ id: user.id, role: user.role, }, 'posts.live:moderate_viewers',);
}

/** GET /posts/:id/live/viewers — every connected socket, with its moderation state. */
export async function listViewers(postId: string, user: User | undefined,): Promise<LiveViewer[]> {
    await requireModerator(user,);
    const row = await loadLivePost(postId,);
    if (!row) throw new NotFoundError('Live show',);
    const [entries, mods,] = await Promise.all([mod.presence(row.id,), mod.getMods(row.id,),],);
    return entries
        .map(({ ipHash: _ip, at: _at, ...e }) => ({ ...e, ...mod.modState(mods.get(e.key,),), }))
        .sort((a, b,) => a.connectedAt.localeCompare(b.connectedAt,));
}

const MODERATED_MESSAGE: Record<LiveModerationAction, string> = {
    mute: 'A moderator muted you — you can still watch, but not chat.',
    unmute: 'You can chat again.',
    silence: 'A moderator silenced you — you cannot chat or react for a while.',
    unsilence: 'You can chat and react again.',
    kick: 'A moderator removed you from this show.',
    ban: 'You have been banned from live shows.',
    unban: '',
};

/** POST /posts/:id/live/moderate */
export async function moderate(postId: string, body: LiveModerateBody, user: User | undefined,): Promise<{ ok: true; state: LiveModerationState; }> {
    await requireModerator(user,);
    const row = await loadLivePost(postId,);
    if (!row) throw new NotFoundError('Live show',);
    const key = body.key;
    if (!/^(u|a):[A-Za-z0-9_-]{1,80}$/.test(key,)) throw new ValidationError('Invalid viewer key',);
    if (key === `u:${user!.id}`) throw new ValidationError('You cannot moderate yourself',);

    const viewers = (await mod.presence(row.id,)).filter((e,) => e.key === key);
    if (key.startsWith('u:',)) {
        const role = viewers[0]?.role ?? (await query<{ role: string; }>(`SELECT role FROM users WHERE id = $1`, [key.slice(2,),],)).rows[0]?.role;
        if (role && isStaffRole(role,)) throw new ForbiddenError('Staff cannot be moderated',);
    }

    const entry = await mod.getMod(row.id, key,);
    let until: number | null = null;
    switch (body.action) {
        case 'mute': entry.muted = true; break;
        case 'unmute': entry.muted = false; break;
        case 'silence': {
            const minutes = Math.max(LIVE_SILENCE_MIN_MINUTES, Math.min(7 * 24 * 60, Math.round(body.minutes ?? LIVE_SILENCE_MIN_MINUTES,),),);
            until = Date.now() + minutes * 60_000;
            entry.silencedUntil = until;
            break;
        }
        case 'unsilence': entry.silencedUntil = null; break;
        case 'kick': entry.kicked = true; break;
        case 'ban': {
            const ipHash = key.startsWith('a:',) ? viewers.find((v,) => v.ipHash)?.ipHash ?? null : null;
            await mod.addBan(key, ipHash, user!.id, body.reason?.slice(0, 500,) ?? null,);
            entry.kicked = true;
            break;
        }
        case 'unban': {
            await mod.removeBan(key,);
            entry.kicked = false;
            break;
        }
        default: throw new ValidationError('Unknown action',);
    }
    await mod.setMod(row.id, key, entry,);

    if (body.action !== 'unban') {
        const action = ({ mute: 'muted', unmute: 'unmuted', silence: 'silenced', unsilence: 'unsilenced', kick: 'kicked', ban: 'banned', } as const)[body.action];
        const event: LiveServerEvent = {
            type: 'moderated', action, message: MODERATED_MESSAGE[body.action],
            ...(until ? { until: new Date(until,).toISOString(), } : {}),
        };
        // A ban removes the viewer from EVERY show they are watching.
        await notifyViewer(body.action === 'ban' ? '*' : row.id, key, event,);
    }
    logger.info('Live viewer moderated', { postId: row.id, key, action: body.action, by: user!.id, },);
    return { ok: true, state: mod.modState(entry,), };
}

/** GET /posts/live/bans — viewers banned from every live show. */
export async function listBans(user: User | undefined,): Promise<LiveBan[]> {
    await requireModerator(user,);
    const r = await query<Record<string, unknown>>(
        `SELECT b.user_id, b.anon_key, b.reason, b.created_at, u.display_name, u.handle, c.display_name AS by_name
           FROM live_bans b
           LEFT JOIN users u ON u.id = b.user_id
           LEFT JOIN users c ON c.id = b.created_by
          ORDER BY b.created_at DESC LIMIT 500`,
    );
    return r.rows.map((b,) => {
        const key = b.user_id ? `u:${b.user_id}` : (b.anon_key as string);
        return {
            key,
            name: (b.display_name as string) || (b.handle as string) || mod.guestName(key,),
            handle: (b.handle as string) || null,
            anonymous: !b.user_id,
            reason: (b.reason as string) || null,
            bannedBy: (b.by_name as string) || null,
            createdAt: new Date(b.created_at as string,).toISOString(),
        };
    },);
}
