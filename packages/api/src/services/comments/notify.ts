/**
 * Comments-feature notifications, hooked onto the discussion engine's events:
 *
 *  - a member gets the `comment_reply` email when someone replies to their
 *    comment on a post or event (Comments → Settings → "Email members when
 *    someone replies", and the purpose's own enable switch);
 *  - staff get `comment_posted` / `comment_reported` through Settings →
 *    Notifications.
 *
 * Forum threads are NOT handled here — the forum sends its own.
 * Registered by import in services/discussions/registerTargets.ts.
 */
import { renderMarkdown, stripMarkdown, } from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { onDiscussionEvent, type DiscussionEvent, } from '../discussions/events';
import { targetSummaries, } from '../discussions/moderation';
import type { CommentRow, } from '../discussions/rows';
import { sendPurposeMail, } from '../mail/purposes';
import { buildNotification, hasRecipients, notify, notifyUser, personLabel, } from '../notifications';
import { COMMENT_TARGETS, replyRecipient, } from './replyRecipient';
import { getSettings, } from './settings';


const excerpt = (body: string, max: number,): string => {
    const t = stripMarkdown(body,).replace(/\s+/g, ' ',).trim();
    return t.length > max ? `${t.slice(0, max - 1,).trimEnd()}…` : t;
};

async function authorName(row: CommentRow,): Promise<string> {
    if (row.a_name) return row.a_name;
    if (row.author_id) {
        const r = await query<{ display_name: string | null; }>(`SELECT display_name FROM users WHERE id = $1`, [row.author_id,],);
        if (r.rows[0]?.display_name) return r.rows[0].display_name;
    }
    return row.guest_name || 'Someone';
}

const absolute = (url: string,): string => (/^https?:\/\//.test(url,) ? url : `${config.frontendUrl.replace(/\/+$/, '',)}${url}`);

async function itemFor(row: CommentRow,): Promise<{ title: string; url: string; }> {
    const s = (await targetSummaries([row,],)).get(`${row.target_type}:${row.target_id}`,);
    return { title: s?.title ?? 'an item', url: s ? absolute(`${s.url}#comment-${row.id}`,) : absolute('/',), };
}

async function sendReplyEmail(row: CommentRow,): Promise<void> {
    if (!row.parent_id) return;
    const parent = (await query<{ author_id: string | null; status: string; body: string; email: string | null; display_name: string | null; }>(
        // A member who turned reply emails off (Profile) has no address here.
        `SELECT c.author_id, c.status, c.body, CASE WHEN u.reply_emails THEN u.email END AS email, u.display_name
           FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.id = $1`,
        [row.parent_id,],
    )).rows[0];
    const settings = await getSettings();
    const to = replyRecipient({
        reply: { authorId: row.author_id, status: row.status, targetType: row.target_type, parentId: row.parent_id, },
        parent: parent ? { authorId: parent.author_id, email: parent.email, status: parent.status, } : null,
        notifyOnReply: settings.notifyOnReply,
    },);
    if (!to || !parent) return;
    const item = await itemFor(row,);
    await sendPurposeMail('comment_reply', {
        to,
        context: {
            user: { name: parent.display_name ?? '', email: to, },
            item,
            reply: { authorName: await authorName(row,), excerpt: excerpt(row.body, 300,), bodyHtml: renderMarkdown(row.body,), },
            comment: { excerpt: excerpt(parent.body, 200,), },
        },
    },);
}

async function notifyStaff(e: DiscussionEvent,): Promise<void> {
    const type = e.type === 'created' ? 'comment_posted' : e.type === 'reported' ? 'comment_reported' : null;
    // Skip the lookups when nobody receives this alert.
    if (!type || !await hasRecipients(type,)) return;
    const row = e.comment;
    const item = await itemFor(row,);
    const name = await authorName(row,);
    const person = await notifyUser({ userId: row.author_id, email: row.guest_email, name, },);
    const who = personLabel(person, name,);
    const moderate = `/admin/comments?target=${row.target_type}:${row.target_id}&status=all`;
    if (e.type === 'created') {
        const pending = row.status === 'pending';
        await notify('comment_posted', await buildNotification({
            title: pending ? 'Comment awaiting approval' : 'New comment',
            subject: `${pending ? 'Comment awaiting approval' : 'New comment'} on ${item.title} (${who})`,
            intro: `${who} commented on “${item.title}”${pending ? ' — it is waiting for approval' : ''}.`,
            person,
            personHeading: row.author_id ? 'Author' : 'Author (guest)',
            sections: [
                { heading: 'Comment', rows: [{ label: 'On', value: item.title, }, { label: 'Status', value: pending ? 'Waiting for approval' : 'Published', }, { label: 'Reply', value: row.parent_id ? 'Yes' : null, },], },
                { text: excerpt(row.body, 1000,), },
            ],
            links: [
                { label: pending ? 'Review comment' : 'Moderate comments', url: moderate, },
                { label: 'View comment', url: item.url, },
                ...(person?.adminUrl ? [{ label: 'View author', url: person.adminUrl, },] : []),
            ],
        },),);
    } else if (e.type === 'reported') {
        const reporter = e.actor?.id
            ? (await query<{ display_name: string | null; }>(`SELECT display_name FROM users WHERE id = $1`, [e.actor.id,],)).rows[0]?.display_name ?? null
            : null;
        await notify('comment_reported', await buildNotification({
            title: 'Comment reported',
            subject: `Comment reported on ${item.title} (${who})`,
            intro: `A comment by ${who} on “${item.title}” was reported.`,
            person,
            personHeading: row.author_id ? 'Author' : 'Author (guest)',
            sections: [
                { heading: 'Report', rows: [{ label: 'Reason', value: e.reason || '—', }, { label: 'Reported by', value: reporter, }, { label: 'On', value: item.title, },], },
                { heading: 'Comment', text: excerpt(row.body, 1000,), },
            ],
            links: [
                { label: 'Review reported comments', url: '/admin/comments?status=reported', },
                { label: 'View comment', url: item.url, },
                ...(person?.adminUrl ? [{ label: 'View author', url: person.adminUrl, },] : []),
            ],
        },),);
    }
}

onDiscussionEvent(async (e,) => {
    if (!COMMENT_TARGETS.has(e.comment.target_type,)) return;
    try {
        if (e.type === 'created' || e.type === 'reported') await notifyStaff(e,);
        if (e.type === 'created' || e.type === 'approved') await sendReplyEmail(e.comment,);
    } catch (err) {
        logger.warn('Comment notification failed', { type: e.type, commentId: e.comment.id, error: (err as Error).message, },);
    }
},);
