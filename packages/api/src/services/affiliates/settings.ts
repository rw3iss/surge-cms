/**
 * Affiliate program settings (`affiliate_settings` site_settings row; Shop →
 * Settings → Affiliate program). Read through a short in-process cache.
 */
import type { AffiliatePayoutSchedule, AffiliateSettings, AffiliateSettingsBody, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import type { AuditContext, } from '../types';

export const AFFILIATE_SETTINGS_KEY = 'affiliate_settings';
export const SCHEDULES: AffiliatePayoutSchedule[] = ['off', 'weekly', 'biweekly', 'monthly',];

export const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
    role: 'affiliate',
    refundWindowDays: 30,
    payoutSchedule: 'off',
    defaultCommissionPercent: 10,
    lastAutoPayoutAt: null,
};

let cache: { at: number; value: AffiliateSettings; } | null = null;

export async function getAffiliateSettings(): Promise<AffiliateSettings> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value;
    const r = await query<{ value: Partial<AffiliateSettings>; }>(`SELECT value FROM site_settings WHERE key = $1`, [AFFILIATE_SETTINGS_KEY,],)
        .catch(() => ({ rows: [], }),);
    const value = { ...DEFAULT_AFFILIATE_SETTINGS, ...(r.rows[0]?.value ?? {}), };
    cache = { at: Date.now(), value, };
    return value;
}

async function write(value: AffiliateSettings, actor: string | null,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [AFFILIATE_SETTINGS_KEY, JSON.stringify(value,), uuidOrNull(actor,),],
    );
    cache = null;
}

export async function updateAffiliateSettings(body: AffiliateSettingsBody, ctx: AuditContext,): Promise<AffiliateSettings> {
    const cur = await getAffiliateSettings();
    const next: AffiliateSettings = { ...cur, };
    if (body.role !== undefined) {
        const role = body.role.trim();
        const exists = await query(`SELECT 1 FROM roles WHERE key = $1`, [role,],);
        if (!exists.rows.length) throw new ValidationError(`Unknown role "${role}".`,);
        next.role = role;
    }
    if (body.refundWindowDays !== undefined) {
        if (!Number.isInteger(body.refundWindowDays,) || body.refundWindowDays < 0 || body.refundWindowDays > 365) {
            throw new ValidationError('The refund window is 0–365 days.',);
        }
        next.refundWindowDays = body.refundWindowDays;
    }
    if (body.payoutSchedule !== undefined) {
        if (!SCHEDULES.includes(body.payoutSchedule,)) throw new ValidationError('Unknown payout schedule.',);
        next.payoutSchedule = body.payoutSchedule;
    }
    if (body.defaultCommissionPercent !== undefined) {
        if (!(body.defaultCommissionPercent >= 0 && body.defaultCommissionPercent <= 100)) throw new ValidationError('Commission is 0–100%.',);
        next.defaultCommissionPercent = body.defaultCommissionPercent;
    }
    await write(next, ctx.userId ?? null,);
    await logAudit({ userId: ctx.userId, action: 'update', entityType: 'affiliate_settings', entityId: AFFILIATE_SETTINGS_KEY, newValues: body as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return next;
}

/** Stamp an automatic payout run. */
export async function markAutoPayoutRun(at: Date,): Promise<void> {
    const cur = await getAffiliateSettings();
    await write({ ...cur, lastAutoPayoutAt: at.toISOString(), }, null,);
}
