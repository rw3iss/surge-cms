/**
 * Inbound provider webhook dispatch.
 *
 * One route serves every provider and event. The row found by
 * `(provider, path, token)` decides what runs, so adding an event is a registry
 * entry plus a handler — never a new route.
 *
 * Security posture, which differs per event and deliberately shows in the admin:
 *
 *  - Apliiq signs only its Fulfillment webhook (`x-apliiq-hmac`). Its
 *    add-to-store, product-search and shipment-complete URLs are unsigned by
 *    their design, so for those the path token is the ONLY credential.
 *  - Therefore: tokens are 32 random bytes, compared in constant time, and
 *    revocable; and anything an unsigned webhook creates lands as a DRAFT. An
 *    endpoint that cannot authenticate its caller must not be able to put
 *    products on the storefront.
 */
import crypto from 'crypto';
import { query, } from '../../../db';
import { logger, } from '../../../utils/logger';
import { getProvider, } from './registry';
import { getProviderRow, } from './settings';

export interface WebhookResult {
    status: number;
    body: unknown;
}

interface Matched {
    id: string;
    provider: string;
    event: string;
    method: string;
    isCustom: boolean;
    enabled: boolean;
}

/**
 * Find the webhook row for this request.
 *
 * Looked up by `(provider, path)` and only then compared on the token, so the
 * comparison itself is constant-time rather than a SQL equality that could leak
 * timing. An unknown token is indistinguishable from an unknown path: both 404.
 */
async function match(provider: string, path: string, token: string,): Promise<Matched | null> {
    const r = await query(
        `SELECT id, provider, event, method, is_custom, enabled, token
         FROM shop_provider_webhooks
         WHERE provider = $1 AND path = $2`,
        [provider, path,],
    );
    const row = r.rows[0];
    if (!row) return null;
    const a = Buffer.from(String(row.token,),);
    const b = Buffer.from(token,);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b,)) return null;
    return {
        id: row.id, provider: row.provider, event: row.event,
        method: row.method, isCustom: row.is_custom, enabled: row.enabled,
    };
}

async function record(id: string, status: number, error?: string,): Promise<void> {
    await query(
        `UPDATE shop_provider_webhooks
         SET last_seen_at = NOW(), last_status = $2, last_error = $3,
             call_count = call_count + 1
         WHERE id = $1`,
        [id, status, error ?? null,],
    ).catch(() => {},);
}

export interface WebhookRequest {
    provider: string;
    path: string;
    token: string;
    method: 'GET' | 'POST';
    rawBody: string;
    query: Record<string, string>;
    headers: Record<string, string>;
}

export async function handleWebhook(req: WebhookRequest,): Promise<WebhookResult> {
    const row = await match(req.provider, req.path, req.token,);
    // Unknown, wrong token, or disabled: all 404, so probing reveals nothing.
    if (!row || !row.enabled) return { status: 404, body: { error: 'Not found', }, };
    if (row.method !== req.method) {
        await record(row.id, 405,);
        return { status: 405, body: { error: 'Method not allowed', }, };
    }

    const provider = getProvider(row.provider,);
    const providerRow = await getProviderRow(row.provider,);
    if (!provider || !providerRow?.enabled) {
        await record(row.id, 503, 'provider disabled',);
        return { status: 503, body: { error: 'Provider is not enabled', }, };
    }

    const declared = provider.webhookEvents?.find((e,) => e.event === row.event);

    // Signed events must verify before the body is looked at.
    if (declared?.signed) {
        const ok = provider.verifyWebhook?.(providerRow.config, req.rawBody, req.headers,) ?? false;
        if (!ok) {
            await record(row.id, 401, 'signature verification failed',);
            logger.warn(`[shop:${row.provider}] webhook ${row.event}: bad signature`,);
            return { status: 401, body: { error: 'Invalid signature', }, };
        }
    }

    // Custom operator-defined endpoints have no handler by design. They exist so
    // a URL can be registered now and wired later; say so rather than implying
    // something happened.
    if (row.isCustom) {
        await record(row.id, 202,);
        return { status: 202, body: { received: true, handled: false, }, };
    }

    try {
        const body = req.rawBody ? JSON.parse(req.rawBody,) as unknown : null;
        const { dispatchProviderWebhook, } = await import('./handlers.js');
        const result = await dispatchProviderWebhook(
            row.provider, row.event, providerRow.config, { body, query: req.query, },
        );
        await record(row.id, result.status,);
        return result;
    } catch (err) {
        const message = (err as Error).message;
        await record(row.id, 500, message,);
        logger.error(`[shop:${row.provider}] webhook ${row.event} failed: ${message}`,);
        return { status: 500, body: { error: 'Webhook handler failed', }, };
    }
}
