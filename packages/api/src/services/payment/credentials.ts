/**
 * Stripe credentials resolver. Keys can be configured two ways — DB wins:
 *   1. Admin UI (Shop → Settings → Payments) → persisted in the `site_settings`
 *      row `stripe_credentials` (JSON { secretKey, publishableKey, webhookSecret }).
 *   2. Env (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY / STRIPE_WEBHOOK_SECRET).
 * A non-blank DB value overrides env per-key; a blank/absent DB value falls back
 * to env. The resolved set is cached in memory (warmed at boot, refreshed on
 * update) so the many synchronous `stripeCredentials()` call sites read it
 * without awaiting. The secret + webhook keys are WRITE-ONLY from the admin API
 * (never echoed back — only "configured" + last-4 leak out).
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { invalidateShopSettingsCache, invalidateSettingsCache, } from '../cache';
import { resetStripeClient, } from './stripe';
import type { AuditContext, } from '../types';

const SETTINGS_KEY = 'stripe_credentials';

export interface StripeCredentials {
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
}

interface StoredCreds { secretKey?: string; publishableKey?: string; webhookSecret?: string; }

let cached: StripeCredentials | null = null;

function envCreds(): StripeCredentials {
    return {
        secretKey: config.stripe.secretKey || '',
        publishableKey: config.stripe.publishableKey || '',
        webhookSecret: config.stripe.webhookSecret || '',
    };
}

async function readStored(): Promise<StoredCreds> {
    try {
        const r = await query<{ value: StoredCreds; }>(
            `SELECT value FROM site_settings WHERE key = $1`,
            [SETTINGS_KEY,],
        );
        return r.rows[0]?.value || {};
    } catch (err) {
        logger.warn(`stripe credentials read failed: ${(err as Error).message}`,);
        return {};
    }
}

function merge(stored: StoredCreds,): StripeCredentials {
    const env = envCreds();
    return {
        secretKey: (stored.secretKey || '').trim() || env.secretKey,
        publishableKey: (stored.publishableKey || '').trim() || env.publishableKey,
        webhookSecret: (stored.webhookSecret || '').trim() || env.webhookSecret,
    };
}

/** Warm/refresh the in-memory cache from the DB. Call at boot + after any
 *  update so a key change lands without a restart. */
export async function refreshStripeCredentials(): Promise<StripeCredentials> {
    cached = merge(await readStored(),);
    resetStripeClient(); // a secret-key change must drop the memoized client
    return cached;
}

/** Sync resolved credentials. Falls back to env-only until the cache is warmed
 *  at boot (so requests before the first refresh still use the env keys). */
export function stripeCredentials(): StripeCredentials {
    return cached ?? envCreds();
}

type KeySource = 'db' | 'env' | 'none';
function sourceOf(dbVal: string | undefined, envVal: string,): KeySource {
    return (dbVal || '').trim() ? 'db' : (envVal ? 'env' : 'none');
}

function last4(v: string,): string {
    return v.length >= 4 ? v.slice(-4,) : '';
}

function keyMode(secret: string,): 'test' | 'live' | null {
    if (!secret) return null;
    return secret.startsWith('sk_live',) || secret.startsWith('rk_live',) ? 'live' : 'test';
}

export interface StripeCredentialsStatus {
    /** Publishable key is public by design — returned in full. */
    publishableKey: string;
    secretKeyConfigured: boolean;
    secretKeyLast4: string;
    webhookConfigured: boolean;
    webhookSecretLast4: string;
    mode: 'test' | 'live' | null;
    sources: { publishable: KeySource; secret: KeySource; webhook: KeySource; };
}

/** Masked status for the admin editor: never echoes the secret/webhook values,
 *  only whether they're set, their last-4, and which source each resolves from. */
export async function credentialsStatus(): Promise<StripeCredentialsStatus> {
    const stored = await readStored();
    const resolved = merge(stored,);
    const env = envCreds();
    return {
        publishableKey: resolved.publishableKey || '',
        secretKeyConfigured: Boolean(resolved.secretKey,),
        secretKeyLast4: last4(resolved.secretKey,),
        webhookConfigured: Boolean(resolved.webhookSecret,),
        webhookSecretLast4: last4(resolved.webhookSecret,),
        mode: keyMode(resolved.secretKey,),
        sources: {
            publishable: sourceOf(stored.publishableKey, env.publishableKey,),
            secret: sourceOf(stored.secretKey, env.secretKey,),
            webhook: sourceOf(stored.webhookSecret, env.webhookSecret,),
        },
    };
}

export interface StripeCredentialsPatch {
    secretKey?: string | null;
    publishableKey?: string | null;
    webhookSecret?: string | null;
}

/** Persist provided keys. Only fields present on the patch are touched; an empty
 *  string CLEARS that key (→ falls back to env). Validates key prefixes and never
 *  audits the raw values (only set/cleared/unchanged). */
export async function updateStripeCredentials(
    patch: StripeCredentialsPatch,
    ctx: AuditContext,
): Promise<StripeCredentialsStatus> {
    const stored = await readStored();
    const next: StoredCreds = { ...stored, };

    const apply = (field: keyof StoredCreds, prefixes: string[], label: string,) => {
        const v = patch[field];
        if (v === undefined) return; // not provided → leave as-is
        const trimmed = (v ?? '').trim();
        if (trimmed && !prefixes.some((p,) => trimmed.startsWith(p,))) {
            throw new ValidationError(`${label} must start with ${prefixes.join(' or ',)}`,);
        }
        if (trimmed) next[field] = trimmed;
        else delete next[field]; // empty → clear (env fallback)
    };
    apply('secretKey', ['sk_', 'rk_',], 'Secret key',);
    apply('publishableKey', ['pk_',], 'Publishable key',);
    apply('webhookSecret', ['whsec_',], 'Webhook secret',);

    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [SETTINGS_KEY, JSON.stringify(next,), uuidOrNull(ctx.userId,),],
    );

    await refreshStripeCredentials();
    // The publishable key rides both the shop-public projection and the general
    // public settings; bust both so the storefront + donations see the new key.
    await invalidateShopSettingsCache();
    await invalidateSettingsCache();

    const changed = (field: keyof StripeCredentialsPatch,) =>
        patch[field] === undefined ? 'unchanged' : ((patch[field] ?? '').toString().trim() ? 'set' : 'cleared');
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'stripe-credentials',
        entityId: 'stripe',
        // NEVER the values — only which keys were set/cleared.
        newValues: {
            secretKey: changed('secretKey',),
            publishableKey: changed('publishableKey',),
            webhookSecret: changed('webhookSecret',),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return credentialsStatus();
}
