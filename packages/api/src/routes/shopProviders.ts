/**
 * Shop Providers admin API.
 *
 * Secrets are never returned readable — `listForClient` masks them, and a masked
 * value sent back means "unchanged". Every route is admin-tier and gated on a
 * permission, per the project's rule that a new surface declares its own.
 */
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import { NotFoundError, } from '../core/errors';
import { requirePermission, } from '../services/permissions';
import { getProvider, } from '../services/shop/providers/registry';
import {
    ensureWebhookRows, getProviderRow, listForClient, listWebhooks,
    regenerateWebhookToken, saveProviderSettings, webhookUrl,
} from '../services/shop/providers/settings';
import { config as appConfig, } from '../config';

const keyParams = z.object({ key: z.string().max(32,), },);
const viewerOf = (user: { id?: string; role?: string; } | undefined,) => ({ id: user?.id, role: user?.role, });

const savePatch = z.object({
    enabled: z.boolean().optional(),
    autoSync: z.boolean().optional(),
    syncIntervalMinutes: z.number().int().min(0,).max(10080,).optional(),
    config: z.record(z.string(), z.unknown(),).optional(),
},);

/** Public base URL, so the admin can show a URL that is actually reachable. */
function baseUrl(): string {
    return appConfig.frontendUrl || '';
}

export const shopProviderRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List every fulfilment provider with its saved settings (secrets masked).',
        handler: async ({ user, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:read',);
            return listForClient();
        },
    },),

    defineRoute({
        method: 'put', path: '/:key', auth: 'admin',
        summary: 'Save a provider\'s credentials and options.',
        input: { params: keyParams, body: savePatch, },
        handler: async ({ params, body, user, audit, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:write',);
            if (!getProvider(params.key,)) throw new NotFoundError(`Provider "${params.key}"`,);
            const row = await saveProviderSettings(params.key, body as never, audit(),);
            // Creating the webhook rows on save (not on first webhook) means the
            // operator can copy the URLs before the provider ever calls us.
            if (row.enabled) await ensureWebhookRows(params.key,);
            return { key: row.key, enabled: row.enabled, };
        },
    },),

    defineRoute({
        method: 'post', path: '/:key/test', auth: 'admin',
        summary: 'Test the provider connection with the saved credentials.',
        input: { params: keyParams, },
        handler: async ({ params, user, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:write',);
            const provider = getProvider(params.key,);
            if (!provider) throw new NotFoundError(`Provider "${params.key}"`,);
            const row = await getProviderRow(params.key,);
            return provider.testConnection(row?.config ?? {},);
        },
    },),

    defineRoute({
        method: 'post', path: '/:key/sync', auth: 'admin',
        summary: 'Pull the provider catalogue now (only for providers that expose one).',
        input: { params: keyParams, },
        handler: async ({ params, user, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:write',);
            const provider = getProvider(params.key,);
            if (!provider) throw new NotFoundError(`Provider "${params.key}"`,);
            if (!provider.syncProducts) {
                // Apliiq lands here: it pushes to us, so there is nothing to pull.
                return { ok: false, message: `${provider.label} does not publish a catalogue to sync — its products are pushed to the store instead.`, };
            }
            const row = await getProviderRow(params.key,);
            const res = await provider.syncProducts(row?.config ?? {},);
            return { ok: true, ...res, };
        },
    },),

    defineRoute({
        method: 'get', path: '/:key/webhooks', auth: 'admin',
        summary: 'The webhook URLs to paste into the provider\'s dashboard.',
        input: { params: keyParams, },
        handler: async ({ params, user, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:read',);
            const provider = getProvider(params.key,);
            if (!provider) throw new NotFoundError(`Provider "${params.key}"`,);
            const rows = await ensureWebhookRows(params.key,);
            const declared = new Map((provider.webhookEvents ?? []).map((e,) => [e.event, e,]),);
            return rows.map((r,) => ({
                id: r.id, event: r.event, label: r.label ?? r.event,
                method: r.method, enabled: r.enabled, isCustom: r.isCustom,
                // Surfaced so an operator can see which endpoints are protected
                // only by their URL.
                signed: declared.get(r.event,)?.signed ?? false,
                url: webhookUrl(baseUrl(), r,),
                lastSeenAt: r.lastSeenAt, lastStatus: r.lastStatus, callCount: r.callCount,
            }),);
        },
    },),

    defineRoute({
        method: 'post', path: '/:key/webhooks/:id/regenerate', auth: 'admin',
        summary: 'Issue a new token for a webhook. The old URL stops working immediately.',
        input: { params: z.object({ key: z.string().max(32,), id: z.string().uuid(), },), },
        handler: async ({ params, user, },) => {
            await requirePermission(viewerOf(user,), 'shop.providers:write',);
            const row = await regenerateWebhookToken(params.id,);
            if (!row) throw new NotFoundError('Webhook',);
            return { id: row.id, url: webhookUrl(baseUrl(), row,), };
        },
    },),
];

export default shopProviderRoutes;
