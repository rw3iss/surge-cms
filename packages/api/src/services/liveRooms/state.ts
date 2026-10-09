/**
 * The live room's source of truth is the `posts` row: `live_status`,
 * `live_started_at`, `live_ended_at` and `type_settings` (chatMode,
 * reactionsEnabled, archiveVideo, muted). Every state change writes the row
 * and re-reads it, so all processes agree.
 */
import type { LiveChatMode, LiveClientCommand, LiveRoomState, LiveStatus, Post, } from '@sitesurge/types';
import { getPostType, } from '@sitesurge/types';
import { query, } from '../../db';
import { cache, } from '../cache';
import { mapRow, } from '../../utils/mapRow';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LivePostRow = Pick<
    Post,
    'id' | 'slug' | 'status' | 'isPrivate' | 'requiredTierId' | 'gateHidden' | 'gateShowSample' | 'gateSamplePercent'
> & {
    postType: string;
    typeSettings: Record<string, unknown>;
    liveStatus: LiveStatus | null;
    liveStartedAt: Date | null;
    liveEndedAt: Date | null;
};

const COLUMNS = `id, slug, status, is_private, required_tier_id, gate_hidden, gate_show_sample, gate_sample_percent,
                 post_type, type_settings, live_status, live_started_at, live_ended_at`;

export async function loadLivePost(postId: string,): Promise<LivePostRow | null> {
    if (!UUID_RE.test(postId,)) return null;
    const r = await query<Record<string, unknown>>(`SELECT ${COLUMNS} FROM posts WHERE id = $1 AND status != 'deleted'`, [postId,],);
    return r.rows[0] ? normalise(mapRow<LivePostRow>(r.rows[0],),) : null;
}

function normalise(row: LivePostRow,): LivePostRow {
    row.typeSettings = row.typeSettings ?? {};
    return row;
}

export function isLivePost(row: LivePostRow,): boolean {
    return getPostType(row.postType,).display === 'live' || row.postType === 'live';
}

export function effectiveStatus(row: LivePostRow,): LiveStatus {
    if (row.liveEndedAt) return 'ended';
    return row.liveStatus ?? 'idle';
}

export function toState(row: LivePostRow, viewers: number,): LiveRoomState {
    const s = { ...(getPostType(row.postType,).settingsDefaults ?? {}), ...row.typeSettings, };
    const iso = (d: Date | null,) => (d ? new Date(d,).toISOString() : null);
    return {
        postId: row.id,
        status: effectiveStatus(row,),
        muted: s.muted === true,
        chatMode: (s.chatMode as LiveChatMode) ?? 'public',
        reactionsEnabled: s.reactionsEnabled !== false,
        archiveVideo: s.archiveVideo !== false,
        startedAt: iso(row.liveStartedAt,),
        endedAt: iso(row.liveEndedAt,),
        viewers,
        // No streaming provider is wired yet.
        providerConnected: false,
    };
}

/** Apply a (pre-authorised) host command to the row. Returns the fresh row. */
export async function applyHostCommand(postId: string, cmd: LiveClientCommand,): Promise<LivePostRow | null> {
    let set: string;
    const params: unknown[] = [postId,];
    const setting = (key: string, value: unknown,) => {
        params.push(JSON.stringify({ [key]: value, },),);
        return `type_settings = COALESCE(type_settings, '{}'::jsonb) || $${params.length}::jsonb`;
    };
    switch (cmd.type) {
        case 'start':
            set = `live_status = 'live', live_started_at = COALESCE(live_started_at, NOW())`;
            break;
        case 'pause':
            set = `live_status = 'paused'`;
            break;
        case 'resume':
            set = `live_status = 'live'`;
            break;
        case 'end':
            set = `live_status = 'ended', live_ended_at = COALESCE(live_ended_at, NOW())`;
            break;
        case 'mute':
        case 'unmute':
            set = setting('muted', cmd.type === 'mute',);
            break;
        case 'chat_mode':
            set = setting('chatMode', cmd.mode,);
            break;
        case 'reactions':
            set = setting('reactionsEnabled', cmd.enabled,);
            break;
        default:
            return loadLivePost(postId,);
    }
    const r = await query<Record<string, unknown>>(
        `UPDATE posts SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING ${COLUMNS}`,
        params,
    );
    await cache.invalidatePostCache(postId,);
    return r.rows[0] ? normalise(mapRow<LivePostRow>(r.rows[0],),) : null;
}
