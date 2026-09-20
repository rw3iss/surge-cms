/**
 * Public unsubscribe + confirmation endpoints. Mounted at the public
 * root (NOT under `/api/v1`) so the URL shape (`/u/<token>`) stays
 * short and works as a `List-Unsubscribe` header target.
 *
 *   GET /u/:token                             — unsubscribe
 *   GET /u/:token/resubscribe                 — opt back in
 *   GET /lists/:slug/confirm/:token           — double-opt-in confirmation
 *
 * The token verification + status transitions + HTML page rendering all
 * live in `services/unsubscribe.ts`; these handlers are thin raw HTML
 * responders. Each route carries its full literal path (mountPath '' in
 * the manifest) since the prefixes differ (/u vs /lists).
 */
import { defineRoute, } from '../api/defineRoute';
import * as unsubscribe from '../services/unsubscribe';

export const unsubscribeRoutes = [

    defineRoute({
        method: 'get', path: '/u/:token', auth: 'public', raw: true,
        summary: 'Unsubscribe from a mailing list (raw HTML page).',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.unsubscribe((req.params.token as string),);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),

    /**
     * RFC 8058 one-click unsubscribe.
     *
     * Mailbox providers POST here when the reader presses the native
     * "Unsubscribe" button — the header `List-Unsubscribe-Post:
     * List-Unsubscribe=One-Click` is a promise that this works. It did not:
     * only a GET route existed, so the POST 403'd on CSRF and Gmail's button
     * silently failed. Gmail has required working one-click unsubscribe from
     * bulk senders since February 2024.
     *
     * Returns 200 with a short body rather than the HTML page — the caller is a
     * machine and will not render it. Uses the same idempotent service as the
     * GET, so a provider that retries cannot cause an error.
     */
    defineRoute({
        method: 'post', path: '/u/:token', auth: 'public', raw: true,
        summary: 'One-click unsubscribe (RFC 8058) — called by mailbox providers.',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.unsubscribe((req.params.token as string),);
            // 200 even for an already-unsubscribed or unknown token: a provider
            // that sees an error may retry, or may flag the sender. The action
            // is idempotent and there is nothing for the caller to fix.
            res.status(200,).type('text/plain',).send('OK',);
        },
    },),

    defineRoute({
        method: 'get', path: '/u/:token/resubscribe', auth: 'public', raw: true,
        summary: 'Resubscribe to a mailing list (raw HTML page).',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.resubscribe((req.params.token as string),);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),

    defineRoute({
        method: 'get', path: '/lists/:slug/confirm/:token', auth: 'public', raw: true,
        summary: 'Confirm a double-opt-in subscription (raw HTML page).',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.confirm((req.params.slug as string), (req.params.token as string),);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),
];
