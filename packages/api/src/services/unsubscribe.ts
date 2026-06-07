/**
 * Token-based unsubscribe + double-opt-in confirmation logic.
 *
 * Lifted out of `routes/unsubscribe.ts`: each function verifies the
 * token / slug, applies the subscriber status transition, and returns a
 * `{ status, html }` pair the route renders verbatim. The HTML page
 * strings live here too (they're tiny, self-contained, and only used by
 * this flow) so the route is a thin raw responder.
 *
 * The pages are intentionally minimal standalone HTML — these URLs are
 * `List-Unsubscribe` header targets and confirmation links opened
 * directly from email clients, outside the SPA.
 */
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import { verifyUnsubscribeToken, } from './mail/unsubscribe';

/** What the route needs to render: an HTTP status + a full HTML page. */
export interface UnsubscribeResult {
    status: number;
    html: string;
}

function page(title: string, body: string,): string {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title,)}</title>
<style>
    body{font:14px/1.5 system-ui,-apple-system,sans-serif;max-width:480px;margin:8vh auto;padding:0 1rem;color:#333}
    h1{font-size:1.4rem;margin-bottom:.5rem}
    .btn{display:inline-block;padding:.5rem 1rem;background:#3498cf;color:#fff;border-radius:6px;text-decoration:none;margin-top:.5rem}
</style></head><body>${body}</body></html>`;
}

function escapeHtml(s: string,): string {
    return s.replace(/[&<>"']/g, (c,) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    } as Record<string, string>)[c]!,);
}

/** GET /u/:token — unsubscribe a subscriber. */
export async function unsubscribe(token: string,): Promise<UnsubscribeResult> {
    const verified = verifyUnsubscribeToken(token,);
    if (!verified) {
        return { status: 400, html: page('Unsubscribe', '<h1>Invalid unsubscribe link.</h1>',), };
    }
    const sub = await subs.findById(verified.subscriberId,);
    const list = await lists.findById(verified.listId,);
    if (!sub || !list) {
        return { status: 404, html: page('Unsubscribe', '<h1>Subscriber not found.</h1>',), };
    }
    if (sub.status !== 'unsubscribed') await subs.setStatus(sub.id, 'unsubscribed',);
    return {
        status: 200,
        html: page('Unsubscribed', `
        <h1>You have been unsubscribed from ${escapeHtml(list.name,)}.</h1>
        <p>Changed your mind?</p>
        <p><a class="btn" href="/u/${encodeURIComponent(token,)}/resubscribe">Resubscribe</a></p>
    `,),
    };
}

/** GET /u/:token/resubscribe — opt back in (pending confirmation when
 *  the list requires double opt-in). */
export async function resubscribe(token: string,): Promise<UnsubscribeResult> {
    const verified = verifyUnsubscribeToken(token,);
    if (!verified) {
        return { status: 400, html: page('Resubscribe', '<h1>Invalid link.</h1>',), };
    }
    const sub = await subs.findById(verified.subscriberId,);
    const list = await lists.findById(verified.listId,);
    if (!sub || !list) {
        return { status: 404, html: page('Resubscribe', '<h1>Subscriber not found.</h1>',), };
    }
    const target = list.doubleOptIn ? 'pending_confirmation' : 'subscribed';
    await subs.setStatus(sub.id, target,);
    return {
        status: 200,
        html: page('Resubscribed', `
        <h1>Welcome back to ${escapeHtml(list.name,)}.</h1>
        ${target === 'pending_confirmation' ? '<p>Please check your email to confirm your subscription.</p>' : ''}
    `,),
    };
}

/** GET /lists/:slug/confirm/:token — double-opt-in confirmation. */
export async function confirm(slug: string, token: string,): Promise<UnsubscribeResult> {
    const list = await lists.findBySlug(slug,);
    if (!list) {
        return { status: 404, html: page('Confirm', '<h1>List not found.</h1>',), };
    }
    const sub = await subs.findByConfirmationToken(list.id, token,);
    if (!sub) {
        return { status: 400, html: page('Confirm', '<h1>Invalid or expired confirmation link.</h1>',), };
    }
    await subs.setStatus(sub.id, 'subscribed',);
    await subs.clearConfirmationToken(sub.id,);
    return {
        status: 200,
        html: page('Confirmed', `
        <h1>Subscription confirmed.</h1>
        <p>You're now subscribed to <strong>${escapeHtml(list.name,)}</strong>.</p>
    `,),
    };
}
