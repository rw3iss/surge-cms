/**
 * Stripe credentials resolver — site-wide default keys plus per-context overrides.
 *
 * Storage: one `site_settings` row `stripe_credentials`:
 *   {
 *     secretKey?, publishableKey?, webhookSecret?,        // the DEFAULT keys
 *     overrides?: {
 *       shop?:      { useDefault?, secretKey?, publishableKey?, webhookSecret? },
 *       donations?: { useDefault?, secretKey?, publishableKey?, webhookSecret? },
 *     }
 *   }
 *
 * Resolution per context:
 *   - `default`  → top-level keys, falling back to STRIPE_* env vars.
 *   - `shop` / `donations` → if the override is absent or `useDefault !== false`
 *     the context INHERITS the default set; otherwise it uses its own keys,
 *     each blank field still falling back to the default (then env).
 *
 * The resolved sets are cached in memory (warmed at boot, refreshed on update)
 * so the synchronous `stripeCredentials(ctx)` call sites resolve without await.
 * Secret + webhook keys are WRITE-ONLY from the admin API (only "configured" +
 * last-4 leak out); the publishable key is public by design.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { invalidateShopSettingsCache, invalidateSettingsCache, } from '../cache';
import { resetStripeClient, } from './stripe';
import type { PaymentContext, } from './types';
import type { AuditContext, } from '../types';

const SETTINGS_KEY = 'stripe_credentials';
const CONTEXTS: PaymentContext[] = ['default', 'shop', 'donations',];

export interface StripeCredentials {
    secretKey: string;
    publishableKey: string;
    webhookSecret: string;
}

interface ContextOverride {
    useDefault?: boolean;
    secretKey?: string;
    publishableKey?: string;
    webhookSecret?: string;
}
interface StoredCreds {
    secretKey?: string;
    publishableKey?: string;
    webhookSecret?: string;
    overrides?: { shop?: ContextOverride; donations?: ContextOverride; };
}

let cache: Record<PaymentContext, StripeCredentials> | null = null;

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

function resolveDefault(stored: StoredCreds,): StripeCredentials {
    const env = envCreds();
    return {
        secretKey: (stored.secretKey || '').trim() || env.secretKey,
        publishableKey: (stored.publishableKey || '').trim() || env.publishableKey,
        webhookSecret: (stored.webhookSecret || '').trim() || env.webhookSecret,
    };
}

/** True when the context override is set to use its own keys (toggle OFF). */
function isOverriding(stored: StoredCreds, context: PaymentContext,): boolean {
    if (context === 'default') return false;
    const ov = stored.overrides?.[context];
    return Boolean(ov) && ov!.useDefault === false;
}

function resolveContext(stored: StoredCreds, context: PaymentContext,): StripeCredentials {
    const def = resolveDefault(stored,);
    if (!isOverriding(stored, context,)) return def;
    const ov = stored.overrides![context as 'shop' | 'donations']!;
    // Own keys, each blank field falling back to the default (then env).
    return {
        secretKey: (ov.secretKey || '').trim() || def.secretKey,
        publishableKey: (ov.publishableKey || '').trim() || def.publishableKey,
        webhookSecret: (ov.webhookSecret || '').trim() || def.webhookSecret,
    };
}

/** Warm/refresh the in-memory cache for every context. Call at boot + after
 *  any update so a key change lands without a restart. */
export async function refreshStripeCredentials(): Promise<void> {
    const stored = await readStored();
    cache = {
        default: resolveContext(stored, 'default',),
        shop: resolveContext(stored, 'shop',),
        donations: resolveContext(stored, 'donations',),
    };
    resetStripeClient(); // a secret-key change must drop every memoized client
}

/** Sync resolved credentials for a context. Falls back to env-only until the
 *  cache is warmed at boot. */
export function stripeCredentials(context: PaymentContext = 'default',): StripeCredentials {
    return cache?.[context] ?? envCreds();
}

/** Distinct, non-empty webhook secrets across all contexts (for verifying an
 *  inbound webhook that may originate from any configured Stripe account). */
export function allWebhookSecrets(): string[] {
    const set = new Set<string>();
    for (const c of CONTEXTS) {
        const s = stripeCredentials(c,).webhookSecret;
        if (s) set.add(s,);
    }
    return [...set,];
}

function last4(v: string,): string {
    return v.length >= 4 ? v.slice(-4,) : '';
}
function keyMode(secret: string,): 'test' | 'live' | null {
    if (!secret) return null;
    return secret.startsWith('sk_live',) || secret.startsWith('rk_live',) ? 'live' : 'test';
}

export interface PaymentCredentialsStatus {
    context: PaymentContext;
    /** The stored "use default keys" toggle (always false for `default`). */
    useDefault: boolean;
    /** Effective: this context currently resolves to the default key set. */
    usingDefault: boolean;
    /** Resolved publishable key (public — returned in full). */
    publishableKey: string;
    secretKeyConfigured: boolean;
    secretKeyLast4: string;
    webhookConfigured: boolean;
    webhookSecretLast4: string;
    mode: 'test' | 'live' | null;
}

/** Masked status for a context — never echoes secret/webhook values. */
export async function credentialsStatus(context: PaymentContext = 'default',): Promise<PaymentCredentialsStatus> {
    const stored = await readStored();
    const resolved = resolveContext(stored, context,);
    const overriding = isOverriding(stored, context,);
    return {
        context,
        useDefault: context === 'default' ? false : !overriding,
        usingDefault: !overriding,
        publishableKey: resolved.publishableKey || '',
        secretKeyConfigured: Boolean(resolved.secretKey,),
        secretKeyLast4: last4(resolved.secretKey,),
        webhookConfigured: Boolean(resolved.webhookSecret,),
        webhookSecretLast4: last4(resolved.webhookSecret,),
        mode: keyMode(resolved.secretKey,),
    };
}

export interface StripeCredentialsPatch {
    context?: PaymentContext;
    useDefault?: boolean;
    secretKey?: string | null;
    publishableKey?: string | null;
    webhookSecret?: string | null;
}

function validatedKeys(patch: StripeCredentialsPatch,): { secretKey?: string; publishableKey?: string; webhookSecret?: string; } {
    const out: { secretKey?: string; publishableKey?: string; webhookSecret?: string; } = {};
    const apply = (field: 'secretKey' | 'publishableKey' | 'webhookSecret', prefixes: string[], label: string,) => {
        const v = patch[field];
        if (v === undefined) return; // not provided → leave as-is
        const trimmed = (v ?? '').trim();
        if (trimmed && !prefixes.some((p,) => trimmed.startsWith(p,))) {
            throw new ValidationError(`${label} must start with ${prefixes.join(' or ',)}`,);
        }
        out[field] = trimmed; // '' clears
    };
    apply('secretKey', ['sk_', 'rk_',], 'Secret key',);
    apply('publishableKey', ['pk_',], 'Publishable key',);
    apply('webhookSecret', ['whsec_',], 'Webhook secret',);
    return out;
}

/** Persist keys for a context. Only fields present are touched; an empty string
 *  clears that key. For sub-contexts, `useDefault` toggles inherit vs override.
 *  Never audits raw values (only set/cleared/unchanged). */
export async function updateStripeCredentials(
    patch: StripeCredentialsPatch,
    ctx: AuditContext,
): Promise<PaymentCredentialsStatus> {
    const context: PaymentContext = patch.context ?? 'default';
    const stored = await readStored();
    const keys = validatedKeys(patch,);

    if (context === 'default') {
        if (keys.secretKey !== undefined) setOrClear(stored, 'secretKey', keys.secretKey,);
        if (keys.publishableKey !== undefined) setOrClear(stored, 'publishableKey', keys.publishableKey,);
        if (keys.webhookSecret !== undefined) setOrClear(stored, 'webhookSecret', keys.webhookSecret,);
    } else {
        stored.overrides = stored.overrides || {};
        const ov: ContextOverride = { ...(stored.overrides[context] || {}), };
        if (patch.useDefault !== undefined) ov.useDefault = patch.useDefault;
        if (keys.secretKey !== undefined) setOrClear(ov, 'secretKey', keys.secretKey,);
        if (keys.publishableKey !== undefined) setOrClear(ov, 'publishableKey', keys.publishableKey,);
        if (keys.webhookSecret !== undefined) setOrClear(ov, 'webhookSecret', keys.webhookSecret,);
        stored.overrides[context] = ov;
    }

    await query(
        `INSERT INTO site_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [SETTINGS_KEY, JSON.stringify(stored,), uuidOrNull(ctx.userId,),],
    );

    await refreshStripeCredentials();
    await invalidateShopSettingsCache();
    await invalidateSettingsCache();

    const changed = (field: 'secretKey' | 'publishableKey' | 'webhookSecret',) =>
        keys[field] === undefined ? 'unchanged' : (keys[field] ? 'set' : 'cleared');
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'stripe-credentials',
        entityId: context,
        newValues: {
            context,
            useDefault: patch.useDefault,
            secretKey: changed('secretKey',),
            publishableKey: changed('publishableKey',),
            webhookSecret: changed('webhookSecret',),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return credentialsStatus(context,);
}

function setOrClear<T extends Record<string, any>,>(obj: T, field: keyof T, value: string,): void {
    if (value) (obj[field] as any) = value;
    else delete obj[field];
}
