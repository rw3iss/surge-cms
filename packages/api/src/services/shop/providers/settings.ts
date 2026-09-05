/**
 * Provider settings + webhook rows.
 *
 * Secrets never leave the server in readable form: `listForClient` replaces any
 * `type: 'secret'` field with a MASK sentinel, and `saveProviderSettings`
 * treats an incoming MASK as "leave the stored value alone". Without that
 * second half, an operator opening the form and pressing Save would wipe their
 * own credentials — the easiest way to break a live integration, so it has its
 * own test.
 */
import crypto from 'crypto';
import { query, } from '../../../db';
import { logAudit, } from '../../audit';
import type { AuditContext, } from '../../types';
import { getProvider, listProviders, } from './registry';
import type { ProviderConfig, ProviderKey, } from './types';

/** Shown in place of a stored secret. Sending it back means "unchanged". */
export const SECRET_MASK = '••••••••';

export interface ProviderRow {
    key: string;
    enabled: boolean;
    config: ProviderConfig;
    autoSync: boolean;
    syncIntervalMinutes: number;
    lastSyncAt: Date | null;
    lastError: string | null;
}

export async function getProviderRow(key: string,): Promise<ProviderRow | null> {
    const r = await query(
        `SELECT key, enabled, config, auto_sync, sync_interval_minutes, last_sync_at, last_error
         FROM shop_providers WHERE key = $1`,
        [key,],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
        key: row.key,
        enabled: row.enabled,
        config: (row.config ?? {}) as ProviderConfig,
        autoSync: row.auto_sync,
        syncIntervalMinutes: row.sync_interval_minutes,
        lastSyncAt: row.last_sync_at,
        lastError: row.last_error,
    };
}

/** Config for a provider that is both enabled and configured, else null —
 *  the single gate every caller uses, mirroring `getPrintifyConfig`. */
export async function getActiveProviderConfig(key: string,): Promise<ProviderConfig | null> {
    const provider = getProvider(key,);
    if (!provider) return null;
    const row = await getProviderRow(key,);
    if (!row?.enabled) return null;
    return provider.isConfigured(row.config,) ? row.config : null;
}

export async function listActiveProviderKeys(): Promise<ProviderKey[]> {
    const out: ProviderKey[] = [];
    for (const p of listProviders()) {
        if (await getActiveProviderConfig(p.key,)) out.push(p.key,);
    }
    return out;
}

function maskConfig(key: string, config: ProviderConfig,): ProviderConfig {
    const provider = getProvider(key,);
    if (!provider) return {};
    const out: ProviderConfig = { ...config, };
    for (const f of provider.configSchema) {
        if (f.type === 'secret' && out[f.key]) out[f.key] = SECRET_MASK;
    }
    return out;
}

/** Every registry provider, merged with its saved row, secrets masked. */
export async function listForClient(): Promise<Array<{
    key: string; label: string; description?: string;
    configSchema: unknown; config: ProviderConfig;
    enabled: boolean; configured: boolean; autoSync: boolean;
    syncIntervalMinutes: number; lastSyncAt: Date | null; lastError: string | null;
    supportsSync: boolean; supportsShippingQuote: boolean;
}>> {
    const rows = await query(`SELECT * FROM shop_providers`,);
    const byKey = new Map(rows.rows.map((r,) => [r.key, r,]),);
    return listProviders().map((p,) => {
        const row = byKey.get(p.key,);
        const config = (row?.config ?? {}) as ProviderConfig;
        return {
            key: p.key,
            label: p.label,
            description: p.description,
            configSchema: p.configSchema,
            config: maskConfig(p.key, config,),
            enabled: Boolean(row?.enabled,),
            configured: p.isConfigured(config,),
            autoSync: Boolean(row?.auto_sync,),
            syncIntervalMinutes: row?.sync_interval_minutes ?? 60,
            lastSyncAt: row?.last_sync_at ?? null,
            lastError: row?.last_error ?? null,
            supportsSync: typeof p.syncProducts === 'function',
            supportsShippingQuote: typeof p.quoteShipping === 'function',
        };
    },);
}

/**
 * Merge a submitted config over the stored one.
 *
 * A secret field arriving as the MASK means the form simply echoed what we
 * showed it, so the stored value is kept. Any other value is a real change.
 */
export function mergeConfig(
    key: string, stored: ProviderConfig, incoming: ProviderConfig,
): ProviderConfig {
    const provider = getProvider(key,);
    const secretKeys = new Set(
        (provider?.configSchema ?? []).filter((f,) => f.type === 'secret').map((f,) => f.key),
    );
    const out: ProviderConfig = { ...stored, };
    for (const [k, v,] of Object.entries(incoming,)) {
        if (secretKeys.has(k,) && (v === SECRET_MASK || v === '')) continue;
        out[k] = v;
    }
    return out;
}

export async function saveProviderSettings(
    key: string,
    patch: { config?: ProviderConfig; enabled?: boolean; autoSync?: boolean; syncIntervalMinutes?: number; },
    ctx: AuditContext,
): Promise<ProviderRow> {
    const provider = getProvider(key,);
    if (!provider) throw new Error(`Unknown provider “${key}”.`,);

    const existing = await getProviderRow(key,);
    const config = patch.config
        ? mergeConfig(key, existing?.config ?? {}, patch.config,)
        : existing?.config ?? {};

    await query(
        `INSERT INTO shop_providers (key, enabled, config, auto_sync, sync_interval_minutes, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (key) DO UPDATE SET
             enabled = EXCLUDED.enabled,
             config = EXCLUDED.config,
             auto_sync = EXCLUDED.auto_sync,
             sync_interval_minutes = EXCLUDED.sync_interval_minutes,
             updated_at = NOW()`,
        [
            key,
            patch.enabled ?? existing?.enabled ?? false,
            JSON.stringify(config,),
            patch.autoSync ?? existing?.autoSync ?? false,
            patch.syncIntervalMinutes ?? existing?.syncIntervalMinutes ?? 60,
        ],
    );

    await logAudit({
        userId: ctx.userId ?? '',
        action: 'update',
        entityType: 'shop-provider',
        // Credentials must never reach the audit log.
        newValues: { key, enabled: patch.enabled, autoSync: patch.autoSync, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },).catch(() => {},);

    return (await getProviderRow(key,))!;
}

// ─── Webhooks ─────────────────────────────────────────────────────

export interface WebhookRow {
    id: string;
    provider: string;
    event: string;
    path: string;
    method: string;
    token: string;
    enabled: boolean;
    isCustom: boolean;
    label: string | null;
    lastSeenAt: Date | null;
    lastStatus: number | null;
    callCount: number;
}

const newToken = () => crypto.randomBytes(32,).toString('base64url',);

/**
 * Create the rows for a provider's declared events, once. Idempotent, so
 * enabling a provider repeatedly never rotates a token that has already been
 * pasted into the provider's dashboard.
 */
export async function ensureWebhookRows(providerKey: string,): Promise<WebhookRow[]> {
    const provider = getProvider(providerKey,);
    for (const ev of provider?.webhookEvents ?? []) {
        await query(
            `INSERT INTO shop_provider_webhooks (provider, event, path, method, token, label)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (provider, event) DO NOTHING`,
            [providerKey, ev.event, ev.path, ev.method, newToken(), ev.label,],
        );
    }
    return listWebhooks(providerKey,);
}

export async function listWebhooks(providerKey: string,): Promise<WebhookRow[]> {
    const r = await query(
        `SELECT id, provider, event, path, method, token, enabled, is_custom, label,
                last_seen_at, last_status, call_count
         FROM shop_provider_webhooks WHERE provider = $1 ORDER BY is_custom, event`,
        [providerKey,],
    );
    return r.rows.map((row,) => ({
        id: row.id, provider: row.provider, event: row.event, path: row.path,
        method: row.method, token: row.token, enabled: row.enabled,
        isCustom: row.is_custom, label: row.label,
        lastSeenAt: row.last_seen_at, lastStatus: row.last_status, callCount: row.call_count,
    }),);
}

/** Full URL to paste into the provider's dashboard. */
export function webhookUrl(baseUrl: string, row: Pick<WebhookRow, 'provider' | 'path' | 'token'>,): string {
    const base = baseUrl.replace(/\/+$/, '',);
    return `${base}/api/v1/shop/webhooks/${row.provider}/${row.path}/${row.token}`;
}

export async function regenerateWebhookToken(id: string,): Promise<WebhookRow | null> {
    const r = await query(
        `UPDATE shop_provider_webhooks SET token = $2 WHERE id = $1 RETURNING provider`,
        [id, newToken(),],
    );
    if (!r.rows[0]) return null;
    const rows = await listWebhooks(r.rows[0].provider,);
    return rows.find((w,) => w.id === id) ?? null;
}
