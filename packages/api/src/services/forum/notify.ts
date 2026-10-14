/**
 * Forum notifications, hooked onto the discussion engine's events:
 *  - the `forum_reply` email: to the thread's author when someone replies, and
 *    to a post's author when someone answers that post (never to oneself, never
 *    twice for one reply);
 *  - staff: `forum_thread_created` and `forum_reported` (Settings → Notifications).
 * Registered by import in services/discussions/registerTargets.ts.
 */
import { renderMarkdown, stripMarkdown, } from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { onDiscussionEvent, type DiscussionEvent, } from '../discussions/events';
import type { CommentRow, } from '../discussions/rows';
import { sendPurposeMail, } from '../mail/purposes';
import { buildNotification, hasRecipients, notify, notifyUser, personLabel, } from '../notifications';
import { threadUrl, } from './forum';

const excerpt = (body: string, max: number,): string => {
    const t = stripMarkdown(body,).replace(/\s+/g, ' ',).trim();
    return t.length > max ? `${t.slice(0, max - 1,).trimEnd()}…` : t;
};
const absolute = (url: string,): string => `${config.frontendUrl.replace(/\/+$/, '',)}${url}`;

interface ThreadInfo { id: string; title: string; url: string; author_id: string | null; }

async function threadOf(id: string,): Promise<ThreadInfo | null> {
    const r = (await query<{ id: string; title: string; slug: string; c_slug: string; author_id: string | null; }>(
        `SELECT t.id, t.title, t.slug, fc.slug AS c_slug, t.author_id
           FROM forum_threads t JOIN forum_categories fc ON fc.id = t.category_id WHERE t.id = $1`, [id,],
    )).rows[0];
    return r ? { id: r.id, title: r.title, url: threadUrl(r.c_slug, r.slug,), author_id: r.author_id, } : null;
}

async function nameOf(userId: string | null,): Promise<string> {
    if (!userId) return 'Someone';
    const r = await query<{ display_name: string | null; }>(`SELECT display_name FROM users WHERE id = $1`, [userId,],);
    return r.rows[0]?.display_name || 'Someone';
}

/** Who should hear about this reply: thread author + the replied-to post's author. */
async function recipients(row: CommentRow, thread: ThreadInfo,): Promise<Array<{ id: string; email: string; name: string; }>> {
    const ids = new Set<string>();
    if (thread.author_id) ids.add(thread.author_id,);
    if (row.parent_id) {
        const p = (await query<{ author_id: string | null; status: string; }>(`SELECT author_id, status FROM comments WHERE id = $1`, [row.parent_id,],)).rows[0];
        if (p?.author_id && p.status === 'visible') ids.add(p.author_id,);
    }
    if (row.author_id) ids.delete(row.author_id,);
    if (!ids.size) return [];
    const r = await query<{ id: string; email: string | null; display_name: string | null; is_active: boolean; }>(
        // Members who turned reply emails off (Profile) are skipped.
        `SELECT id, email, display_name, is_active FROM users WHERE id = ANY($1::uuid[]) AND reply_emails`, [[...ids,],],
    );
    return r.rows.filter((u,) => u.email && u.is_active !== false).map((u,) => ({ id: u.id, email: u.email!, name: u.display_name ?? '', }));
}

async function sendReplyEmails(row: CommentRow,): Promise<void> {
    if (row.is_opening || row.status !== 'visible') return;
    const thread = await threadOf(row.target_id,);
    if (!thread) return;
    const authorName = await nameOf(row.author_id,);
    for (const to of await recipients(row, thread,)) {
        await sendPurposeMail('forum_reply', {
            to: to.email,
            context: {
                user: { name: to.name, email: to.email, },
                thread: { title: thread.title, url: absolute(`${thread.url}#comment-${row.id}`,), },
                reply: { authorName, excerpt: excerpt(row.body, 300,), bodyHtml: renderMarkdown(row.body,), },
            },
        },).catch((err,) => logger.warn('Forum reply email failed', { to: to.id, error: (err as Error).message, },));
    }
}

async function notifyStaff(e: DiscussionEvent,): Promise<void> {
    const type = e.type === 'created' && e.comment.is_opening ? 'forum_thread_created' : e.type === 'reported' ? 'forum_reported' : null;
    // Skip the lookups when nobody receives this alert.
    if (!type || !await hasRecipients(type,)) return;
    const row = e.comment;
    const thread = await threadOf(row.target_id,);
    if (!thread) return;
    const person = await notifyUser({ userId: row.author_id, email: row.guest_email, name: row.guest_name, },);
    const who = personLabel(person, await nameOf(row.author_id,),);
    const reporter = e.type === 'reported' && e.actor?.id ? await nameOf(e.actor.id,) : null;
    const pending = row.status === 'pending';
    const postUrl = row.is_opening ? thread.url : `${thread.url}#comment-${row.id}`;
    if (e.type === 'created' && row.is_opening) {
        await notify('forum_thread_created', await buildNotification({
            title: pending ? 'Forum thread awaiting approval' : 'New forum thread',
            subject: `${pending ? 'Forum thread awaiting approval' : 'New forum thread'}: ${thread.title} (${who})`,
            intro: `${who} started “${thread.title}”${pending ? ' — it is waiting for approval' : ''}.`,
            person,
            personHeading: 'Author',
            sections: [
                { heading: 'Thread', rows: [{ label: 'Title', value: thread.title, }, { label: 'Status', value: pending ? 'Waiting for approval' : 'Published', },], },
                { heading: 'Opening post', text: excerpt(row.body, 1000,), },
            ],
            links: [
                { label: pending ? 'Review in moderation' : 'View thread', url: pending ? '/admin/comments?scope=forum&status=pending' : thread.url, },
                ...(pending ? [{ label: 'View thread', url: thread.url, },] : []),
                { label: 'Forum admin', url: '/admin/forum', },
                ...(person?.adminUrl ? [{ label: 'View author', url: person.adminUrl, },] : []),
            ],
        },),);
    } else if (e.type === 'reported') {
        await notify('forum_reported', await buildNotification({
            title: 'Forum post reported',
            subject: `Forum post reported in ${thread.title} (${who})`,
            intro: `A post by ${who} in “${thread.title}” was reported.`,
            person,
            personHeading: 'Author',
            sections: [
                { heading: 'Report', rows: [{ label: 'Reason', value: e.reason || '—', }, { label: 'Reported by', value: reporter, }, { label: 'Thread', value: thread.title, },], },
                { heading: 'Post', text: excerpt(row.body, 1000,), },
            ],
            links: [
                { label: 'Review reported posts', url: '/admin/comments?scope=forum&status=reported', },
                { label: 'View post', url: postUrl, },
                ...(person?.adminUrl ? [{ label: 'View author', url: person.adminUrl, },] : []),
            ],
        },),);
    }
}

onDiscussionEvent(async (e,) => {
    if (e.comment.target_type !== 'forum_thread') return;
    try {
        if (e.type === 'created' || e.type === 'reported') await notifyStaff(e,);
        if (e.type === 'created' || e.type === 'approved') await sendReplyEmails(e.comment,);
    } catch (err) {
        logger.warn('Forum notification failed', { type: e.type, commentId: e.comment.id, error: (err as Error).message, },);
    }
},);
