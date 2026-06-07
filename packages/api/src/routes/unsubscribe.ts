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
            const result = await unsubscribe.unsubscribe(req.params.token,);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),

    defineRoute({
        method: 'get', path: '/u/:token/resubscribe', auth: 'public', raw: true,
        summary: 'Resubscribe to a mailing list (raw HTML page).',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.resubscribe(req.params.token,);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),

    defineRoute({
        method: 'get', path: '/lists/:slug/confirm/:token', auth: 'public', raw: true,
        summary: 'Confirm a double-opt-in subscription (raw HTML page).',
        handler: async ({ req, res, },) => {
            const result = await unsubscribe.confirm(req.params.slug, req.params.token,);
            res.status(result.status,).type('html',).send(result.html,);
        },
    },),
];
