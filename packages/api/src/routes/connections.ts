/**
 * Social-connection routes on the manifest framework.
 *
 * All business logic (data access, credential masking, OAuth orchestration,
 * cron side-effects) lives in `services/connections.ts`. The OAuth callback
 * is `raw: true` — it redirects back to the admin settings page; its
 * success/error query strings are preserved byte-for-byte from the
 * pre-framework handler.
 */
import { z, } from 'zod';
import type {
    ConnectionProviderParams,
    ConnectionReorderBody,
    ConnectionUpsertBody,
} from '@sitesurge/types';
import { config, } from '../config';
import { defineRoute, } from '../api/defineRoute';
import * as connections from '../services/connections';
import { logger, } from '../utils/logger';

// ─── Schemas ──────────────────────────────────────────────────────

const providerParams = z.object({ provider: z.string(), },) satisfies z.ZodType<ConnectionProviderParams>;

/** Path-param schema for routes that mutate a specific provider. Uses the
 *  same enum as the POST body so an invalid provider yields a 400
 *  VALIDATION_ERROR with field details (parity with the pre-framework PUT,
 *  which validated the provider through the zod enum). */
const providerEnumParams = z.object({
    provider: z.enum(connections.VALID_PROVIDERS as [string, ...string[]],),
},) satisfies z.ZodType<ConnectionProviderParams>;

const upsertSchema = z.object({
    provider: z.enum(connections.VALID_PROVIDERS as [string, ...string[]],),
    enabled: z.boolean().optional(),
    autoPublish: z.boolean().optional(),
    autoPublishCount: z.number().nullable().optional(),
    credentials: z.record(z.string(), z.unknown(),).optional(),
},) satisfies z.ZodType<ConnectionUpsertBody>;

// ─── Routes ───────────────────────────────────────────────────────
// Literal/segmented paths (/:provider/oauth/...) are distinct from the
// bare /:provider catch-alls, so ordering is unambiguous here.

export const connectionsRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List all social connections (credentials masked).',
        handler: () => connections.list(),
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create/update a connection\'s app credentials + publish settings.',
        input: { body: upsertSchema, },
        handler: async ({ body, userId, },) => {
            await connections.upsert(body, userId!,);
            return { message: 'Connection saved', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:provider/oauth/authorize', auth: 'admin',
        summary: 'Generate an OAuth authorization URL + state for a provider.',
        input: { params: providerParams, },
        handler: ({ params, userId, },) => connections.startOAuth(params.provider, userId,),
    },),

    defineRoute({
        method: 'get', path: '/:provider/oauth/callback', auth: 'public', raw: true,
        summary: 'OAuth provider callback. Persists tokens, then redirects to admin settings.',
        input: { params: providerParams, },
        handler: async ({ req, res, },) => {
            const provider = req.params.provider as string;
            const { code, state, error: oauthError, error_description, } = req.query;
            const frontendUrl = `${config.frontendUrl}/admin/settings`;

            try {
                const result = await connections.completeOAuth(
                    provider,
                    typeof code === 'string' ? code : undefined,
                    typeof state === 'string' ? state : undefined,
                    oauthError,
                    error_description,
                );

                if (result.kind === 'success') {
                    res.redirect(`${frontendUrl}?oauth_success=${result.provider}`,);
                } else {
                    res.redirect(`${frontendUrl}?oauth_error=${result.query}`,);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'OAuth connection failed';
                logger.error(`OAuth callback error for ${provider}`, { error, },);
                res.redirect(`${frontendUrl}?oauth_error=${encodeURIComponent(message,)}`,);
            }
        },
    },),

    defineRoute({
        method: 'put', path: '/:provider/reorder', auth: 'admin',
        summary: 'Move a connection up/down in the manual sort order.',
        input: {
            params: providerEnumParams,
            body: z.object({ direction: z.enum(['up', 'down',],), },) satisfies z.ZodType<ConnectionReorderBody>,
        },
        handler: async ({ params, body, },) => {
            await connections.reorder(params.provider, body.direction,);
            return { message: 'Connection reordered', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:provider', auth: 'admin',
        summary: 'Fetch one connection (credentials masked). null when not found.',
        input: { params: providerParams, },
        handler: ({ params, },) => connections.get(params.provider,),
    },),

    defineRoute({
        method: 'put', path: '/:provider', auth: 'admin',
        summary: 'Update a connection (provider taken from the path).',
        input: { params: providerEnumParams, body: upsertSchema.partial(), },
        handler: async ({ params, body, userId, },) => {
            await connections.upsert({ ...body, provider: params.provider, }, userId!,);
            return { message: 'Connection updated', };
        },
    },),

    defineRoute({
        method: 'delete', path: '/:provider', auth: 'admin',
        summary: 'Disconnect: clear tokens (keep app creds), stop cron, bust cache.',
        input: { params: providerParams, },
        handler: async ({ params, },) => {
            await connections.disconnect(params.provider,);
            return { message: 'Disconnected', };
        },
    },),
];
