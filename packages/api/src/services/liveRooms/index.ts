/**
 * Live rooms (live-show posts) — REST side. The socket lives in `server.ts`
 * (attached in lib.ts); this barrel serves `GET /posts/:id/live`,
 * `POST /posts/:id/live/ticket`, and the staff viewer list + moderation
 * (`GET /posts/:id/live/viewers`, `POST /posts/:id/live/moderate`).
 */
import type {
    LiveBan, LiveChatMessage, LiveModerateBody, LiveModerationAction, LiveModerationState, LiveRoomState, LiveServerEvent, LiveViewer, PostLiveTicketResponse, User,
} from '@sitesurge/types';
import { isStaffRole, LIVE_BAN_MAX_MINUTES, LIVE_SILENCE_MIN_MINUTES, } from '@sitesurge/types';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { logAudit, } from '../audit';
import type { AuditContext, } from '../types';
import { requirePermission, } from '../permissions';
import { isHost, viewAccess, } from './access';
import * as mod from './moderation';
import { notifyViewer, } from './server';
import { effectiveStatus, loadLivePost, toState, } from './state';
import * as store from './store';
import * as chatLog from './chatLog';
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

/**
 * GET /posts/:id/live/chat — the saved chat of an ENDED show, for the replay
 * (same view gate as the show; deleted lines left out). Empty while live:
 * the room's own history covers that.
 */
export async function replayChat(postId: string, user: User | undefined,): Promise<LiveChatMessage[]> {
    const row = await requireViewable(postId, user,);
    if (effectiveStatus(row,) !== 'ended') return [];
    return chatLog.readChatLog(row.id,);
}

/** The host's transcript (every line, deleted ones marked). */
export async function transcript(postId: string,): Promise<{ filename: string; text: string; }> {
    const row = await loadLivePost(postId,);
    if (!row) throw new NotFoundError('Live show',);
    const title = row.title || 'Live show';
    const text = chatLog.transcriptText(title, await chatLog.readChatLog(row.id, { includeDeleted: true, limit: 20_000, },),);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-',).replace(/^-|-$/g, '',).slice(0, 60,) || 'live-show';
    return { filename: `${slug}-chat.txt`, text, };
}

/** POST /posts/:id/live/ticket — 409 once the show has ended. */
export async function issueTicketFor(postId: string, user: User | undefined,): Promise<PostLiveTicketResponse> {
    const row = await requireViewable(postId, user,);
    if (effectiveStatus(row,) === 'ended') throw new ConflictError('This show has ended', { code: 'ended', },);
    const userId = user?.id ?? null;
    // A banned (every show) or kicked (this show) member gets no ticket — the
    // socket checks again per command, this just fails early and clearly.
    if (userId && !isStaffRole(user!.role,)) {
        const key = `u:${userId}`;
        if (await mod.isBanned(key, null,)) throw new ForbiddenError('You have been banned from live shows',);
        if ((await mod.getMod(row.id, key,)).kicked) throw new ForbiddenError('A moderator removed you from this show',);
    }
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
export async function moderate(postId: string, body: LiveModerateBody, user: User | undefined, ctx?: AuditContext,): Promise<{ ok: true; state: LiveModerationState; }> {
    await requireModerator(user,);
    const row = await loadLivePost(postId,);
    if (!row) throw new NotFoundError('Live show',);
    const key = body.key;
    if (!mod.isValidViewerKey(key,)) throw new ValidationError('Invalid viewer key',);
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
            await mod.addBan(key, ipHash, user!.id, body.reason?.slice(0, 500,) ?? null, {
                minutes: body.minutes ? Math.min(LIVE_BAN_MAX_MINUTES, body.minutes,) : null,
                postId: row.id,
            },);
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
    await logAudit({
        userId: ctx?.userId ?? user!.id,
        action: `live_${body.action}`,
        entityType: 'post',
        entityId: row.id,
        newValues: { key, ...(body.action === 'silence' ? { minutes: body.minutes ?? LIVE_SILENCE_MIN_MINUTES, } : {}), ...(body.reason ? { reason: body.reason.slice(0, 500,), } : {}), },
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
    },);
    return { ok: true, state: mod.modState(entry,), };
}

/** GET /posts/live/bans — viewers banned from every live show. */
export async function listBans(user: User | undefined,): Promise<LiveBan[]> {
    await requireModerator(user,);
    const r = await query<Record<string, unknown>>(
        `SELECT b.user_id, b.anon_key, b.reason, b.created_at, b.expires_at, u.display_name, u.handle,
                c.display_name AS by_name, p.title AS show_title
           FROM live_bans b
           LEFT JOIN users u ON u.id = b.user_id
           LEFT JOIN users c ON c.id = b.created_by
           LEFT JOIN posts p ON p.id = b.post_id
          WHERE b.expires_at IS NULL OR b.expires_at > NOW()
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
            expiresAt: b.expires_at ? new Date(b.expires_at as string,).toISOString() : null,
            fromShow: (b.show_title as string) || null,
        };
    },);
}
