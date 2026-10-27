/**
 * Contributor post REVIEW: a post submitted by a user whose `posts:publish`
 * grant is in `approval` mode sits at `pending_review`; a reviewer (plain
 * `posts:publish` allow) approves it (→ published) or returns it with a note
 * (→ draft). The team is alerted on submit (notification `post_submitted`,
 * mail purpose `post_submitted_admin`); the author is emailed the result
 * (`post_review_result`).
 */
import { query, } from '../db';
import { ForbiddenError, NotFoundError, ValidationError, } from '../core/errors';
import { logger, } from '../utils/logger';
import { sendPurposeMail, } from './mail/purposes';
import { buildNotification, notifyUser, notifyWith, personLabel, siteBaseUrl, } from './notifications';
import { checkMode, } from './permissions';
import * as posts from './posts';
import type { AuditContext, } from './types';

interface PostRow { id: string; title: string; slug: string; status: string; author_id: string | null; }

async function load(id: string,): Promise<PostRow> {
    const r = await query<PostRow>(`SELECT id, title, slug, status, author_id FROM posts WHERE id = $1`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Post',);
    return r.rows[0];
}

/** After a contributor's save moved a post to `pending_review`: stamp it + alert the team. Never throws. */
export function submitted(postId: string, userId: string,): void {
    void (async () => {
        await query(`UPDATE posts SET submitted_at = NOW(), review_note = NULL WHERE id = $1`, [postId,],);
        const post = await load(postId,);
        const base = await siteBaseUrl();
        const editUrl = `${base}/admin/posts/${postId}`;
        await notifyWith('post_submitted', async () => {
            const person = await notifyUser({ userId, },);
            const who = personLabel(person, 'A contributor',);
            const msg = await buildNotification({
                title: 'New post up for review',
                subject: `New post up for review: ${post.title} (${who})`,
                intro: `${who} submitted “${post.title}” for review. Open it to publish it (and pay the contributor, when payouts are on) or return it with a note.`,
                person,
                personHeading: 'Author',
                links: [
                    { label: 'Review the post', url: `/admin/posts/${postId}`, },
                    { label: 'All posts waiting for review', url: '/admin/posts?status=pending_review', },
                ],
            },);
            return {
                ...msg,
                purpose: 'post_submitted_admin',
                context: { post: { title: post.title, url: editUrl, }, author: { name: person?.name ?? '', email: person?.email ?? '', }, },
            };
        }, { subject: `New post up for review: ${post.title}`, text: `A post was submitted for review: ${post.title}\n${editUrl}`, },);
    })().catch((e: unknown,) => logger.warn('post submitted notice failed', { postId, error: (e as Error).message, },),);
}

/** Approve (publish) or return (to draft, with a note) a post waiting for review. */
export async function review(
    id: string,
    action: 'approve' | 'return',
    note: string | undefined,
    reviewer: { id: string; role?: string; },
    ctx: AuditContext,
    /** Contributor payout for this post (cents) instead of the default — only when contributor payouts are on. */
    payoutCents?: number,
): Promise<Awaited<ReturnType<typeof posts.update>>> {
    // A reviewer needs a PLAIN allow — an approval-mode grant cannot approve itself.
    if (await checkMode(reviewer, 'posts:publish',) !== 'allow') throw new ForbiddenError('You may not publish posts.',);
    const post = await load(id,);
    if (post.status !== 'pending_review') throw new ValidationError('This post is not waiting for review.',);
    const text = note?.trim() || null;
    const updated = await posts.update(id, { status: action === 'approve' ? 'published' : 'draft', }, ctx,);
    await query(
        `UPDATE posts SET reviewed_by = $2, reviewed_at = NOW(), review_note = $3,
                published_at = CASE WHEN $4 THEN COALESCE(published_at, NOW()) ELSE published_at END
          WHERE id = $1`,
        [id, reviewer.id, text, action === 'approve',],
    );
    // Contributor payouts on: an approved contribution is credited and the
    // author + team get the "content published" emails instead.
    const contribution = action === 'approve'
        ? await import('./contributions/index.js').then((m,) => m.onApproved(id, payoutCents, ctx,),).catch(() => false)
        : false;
    if (post.author_id && !contribution) {
        const a = (await query<{ email: string; display_name: string | null; }>(`SELECT email, display_name FROM users WHERE id = $1`, [post.author_id,],)).rows[0];
        if (a?.email) {
            const base = await siteBaseUrl();
            void sendPurposeMail('post_review_result', {
                to: a.email,
                context: {
                    user: { name: a.display_name ?? '', email: a.email, },
                    post: { title: post.title, url: action === 'approve' ? `${base}/posts/${post.slug}` : `${base}/admin/posts/${id}`, },
                    review: { approved: action === 'approve' ? 'yes' : '', note: text ?? '', },
                },
            },).catch(() => {},);
        }
    }
    return { ...updated, reviewNote: text, } as typeof updated;
}
