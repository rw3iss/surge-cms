/**
 * Live chat kept after the show (`live_chat_messages`, migration 176).
 *
 * The room's Redis history holds only the last 50 lines for 7 days; this log
 * keeps every message so replay viewers can read the chat, moderators have a
 * record (a deleted message is MARKED, not dropped) and the host can download
 * a transcript.
 *
 * Best-effort and batched: messages are buffered in memory and inserted in one
 * statement every FLUSH_MS (or at FLUSH_AT rows). A DB blip loses at most one
 * batch and never fails a chat command.
 */
import type { LiveChatMessage, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';

const FLUSH_MS = 2_000;
export const FLUSH_AT = 50;

interface Pending { postId: string; msg: LiveChatMessage; }
let buffer: Pending[] = [];
const pendingDeletes: { postId: string; id: string; by: string | null; }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function schedule(): void {
    if (buffer.length >= FLUSH_AT) { void flushChatLog(); return; }
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flushChatLog(); }, FLUSH_MS,);
    timer.unref?.();
}

/** Queue a message for the log. */
export function logChatMessage(postId: string, msg: LiveChatMessage,): void {
    if (!UUID.test(postId,) || !UUID.test(msg.id,)) return;
    buffer.push({ postId, msg, },);
    schedule();
}

/** Mark a message deleted (kept for the record; hidden from replays + transcripts' main body). */
export function logChatDeletion(postId: string, id: string, by: string | null,): void {
    if (!UUID.test(postId,) || !UUID.test(id,)) return;
    pendingDeletes.push({ postId, id, by: by && UUID.test(by,) ? by : null, },);
    schedule();
}

/** Write what is buffered. Safe to call any time (shutdown, tests). */
export async function flushChatLog(): Promise<void> {
    if (timer) { clearTimeout(timer,); timer = null; }
    const batch = buffer;
    buffer = [];
    if (batch.length) {
        const cols = ['id', 'post_id', 'user_id', 'name', 'handle', 'role', 'body', 'reply_to', 'created_at',];
        const params: unknown[] = [];
        const rows = batch.map(({ postId, msg, },) => {
            params.push(
                msg.id, postId, msg.userId && UUID.test(msg.userId,) ? msg.userId : null, msg.name, msg.handle ?? null,
                msg.role ?? null, msg.text, msg.replyTo ? JSON.stringify(msg.replyTo,) : null, msg.at,
            );
            const base = params.length - cols.length;
            return `(${cols.map((_, i,) => `$${base + i + 1}`).join(', ',)})`;
        },);
        try {
            await query(`INSERT INTO live_chat_messages (${cols.join(', ',)}) VALUES ${rows.join(', ',)} ON CONFLICT (id) DO NOTHING`, params,);
        } catch (e) {
            logger.warn('live chat log: insert failed', { rows: batch.length, error: (e as Error).message, },);
        }
    }
    const dels = pendingDeletes.splice(0,);
    for (const d of dels) {
        try {
            await query(
                `UPDATE live_chat_messages SET deleted_at = NOW(), deleted_by = $3 WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL`,
                [d.id, d.postId, d.by,],
            );
        } catch (e) {
            logger.warn('live chat log: delete mark failed', { error: (e as Error).message, },);
        }
    }
}

interface LogRow {
    id: string; user_id: string | null; name: string; handle: string | null; role: string | null; body: string;
    reply_to: LiveChatMessage['replyTo']; created_at: Date; deleted_at: Date | null;
}

/** Chat of a show, oldest first (deleted lines left out unless `includeDeleted`). */
export async function readChatLog(postId: string, opts: { includeDeleted?: boolean; limit?: number; } = {},): Promise<(LiveChatMessage & { deletedAt?: string | null; })[]> {
    await flushChatLog();
    const limit = Math.min(20_000, Math.max(1, opts.limit ?? 5_000,),);
    const r = await query<LogRow>(
        `SELECT id, user_id, name, handle, role, body, reply_to, created_at, deleted_at FROM live_chat_messages
          WHERE post_id = $1 ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'}
          ORDER BY created_at ASC LIMIT ${limit}`,
        [postId,],
    );
    return r.rows.map((m,) => ({
        id: m.id, userId: m.user_id, name: m.name, handle: m.handle, role: m.role, text: m.body,
        at: new Date(m.created_at,).toISOString(), replyTo: m.reply_to ?? null,
        ...(opts.includeDeleted ? { deletedAt: m.deleted_at ? new Date(m.deleted_at,).toISOString() : null, } : {}),
    }));
}

/** PURE — a plain-text transcript ("[HH:MM:SS] Name: text"; deleted lines marked). */
export function transcriptText(title: string, messages: (LiveChatMessage & { deletedAt?: string | null; })[],): string {
    const lines = [`Chat transcript — ${title}`, `${messages.length} message${messages.length === 1 ? '' : 's'}`, '',];
    for (const m of messages) {
        const t = new Date(m.at,).toISOString().replace('T', ' ',).slice(0, 19,);
        const reply = m.replyTo ? ` (replying to ${m.replyTo.name})` : '';
        const del = m.deletedAt ? ' [deleted by a moderator]' : '';
        lines.push(`[${t}] ${m.name}${m.handle ? ` @${m.handle}` : ''}${reply}: ${m.text.replace(/\r?\n/g, ' ',)}${del}`,);
    }
    return `${lines.join('\n',)}\n`;
}
