/**
 * Contributor compensation settings (`contributor_settings` site_settings row;
 * Posts → Settings → Contributions). Read through a short in-process cache.
 */
import type { AffiliatePayoutSchedule, ContributorSettings, ContributorSettingsBody, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import { maskedConnectSecret, setConnectWebhookSecret, } from '../partners/settings';
import type { AuditContext, } from '../types';

export const CONTRIBUTOR_SETTINGS_KEY = 'contributor_settings';
const SCHEDULES: AffiliatePayoutSchedule[] = ['off', 'weekly', 'biweekly', 'monthly',];

export const DEFAULT_CONTRIBUTOR_SETTINGS: ContributorSettings = {
    enabled: false,
    defaultPayoutCents: 4000,
    currency: 'usd',
    holdDays: 0,
    payoutSchedule: 'off',
    lastAutoPayoutAt: null,
};

let cache: { at: number; value: ContributorSettings; } | null = null;

export async function getContributorSettings(): Promise<ContributorSettings> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value;
    const r = await query<{ value: Partial<ContributorSettings>; }>(`SELECT value FROM site_settings WHERE key = $1`, [CONTRIBUTOR_SETTINGS_KEY,],)
        .catch(() => ({ rows: [], }),);
    const value = { ...DEFAULT_CONTRIBUTOR_SETTINGS, ...(r.rows[0]?.value ?? {}), };
    delete value.connectWebhookSecret;
    cache = { at: Date.now(), value, };
    return value;
}

/** For the admin: + the shared Connect webhook secret, masked. */
export async function settingsForAdmin(): Promise<ContributorSettings> {
    return { ...await getContributorSettings(), connectWebhookSecret: await maskedConnectSecret(), };
}

async function write(value: ContributorSettings, actor: string | null,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [CONTRIBUTOR_SETTINGS_KEY, JSON.stringify(value,), uuidOrNull(actor,),],
    );
    cache = null;
}

export async function updateContributorSettings(body: ContributorSettingsBody, ctx: AuditContext,): Promise<ContributorSettings> {
    const next: ContributorSettings = { ...await getContributorSettings(), };
    if (body.enabled !== undefined) next.enabled = body.enabled === true;
    if (body.defaultPayoutCents !== undefined) {
        if (!Number.isInteger(body.defaultPayoutCents,) || body.defaultPayoutCents < 0 || body.defaultPayoutCents > 10_000_000) {
            throw new ValidationError('The default payout is $0–$100,000.',);
        }
        next.defaultPayoutCents = body.defaultPayoutCents;
    }
    if (body.currency !== undefined) {
        if (!/^[a-z]{3}$/i.test(body.currency,)) throw new ValidationError('Currency: a 3-letter code (usd).',);
        next.currency = body.currency.toLowerCase();
    }
    if (body.holdDays !== undefined) {
        if (!Number.isInteger(body.holdDays,) || body.holdDays < 0 || body.holdDays > 365) throw new ValidationError('The holding period is 0–365 days.',);
        next.holdDays = body.holdDays;
    }
    if (body.payoutSchedule !== undefined) {
        if (!SCHEDULES.includes(body.payoutSchedule,)) throw new ValidationError('Unknown payout schedule.',);
        next.payoutSchedule = body.payoutSchedule;
    }
    await setConnectWebhookSecret(body.connectWebhookSecret, ctx.userId ?? null,);
    await write(next, ctx.userId ?? null,);
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'contributor_settings', entityId: CONTRIBUTOR_SETTINGS_KEY,
        newValues: { ...body, connectWebhookSecret: body.connectWebhookSecret ? '(set)' : undefined, } as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return settingsForAdmin();
}

export async function markContributorAutoPayoutRun(at: Date,): Promise<void> {
    await write({ ...await getContributorSettings(), lastAutoPayoutAt: at.toISOString(), }, null,);
}
