/**
 * Affiliate program (feature `affiliates`, requires `shop`). Guide:
 * docs/how-it-works/AFFILIATES-AND-DISCOUNTS.md.
 *
 *   - An AFFILIATE = a user holding the configured role (main or additional;
 *     default `affiliate`, Shop → Settings → Affiliate program).
 *   - Their codes are discount codes with `affiliate_user_id` (services/shop/discounts).
 *   - Commissions: ./earnings; payouts: ./payouts; Stripe Connect: ./stripeConnect.
 */
import type {
    AffiliateCode, AffiliateMeResponse, AffiliateMember, AffiliateMemberDetail, AffiliateStats, ShopDiscountCode, ShopDiscountCodeBody,
} from '@sitesurge/types';
import { config, } from '../../config';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import * as discounts from '../shop/discounts';
import type { AuditContext, } from '../types';
import { balanceFor, earningsFor, payoutsFor, } from './earnings';
import { getAffiliateSettings, } from './settings';
import { accountRow, statusOf, } from './stripeConnect';

export * from './settings';
export { payOut, runScheduledPayouts, } from './payouts';
export { dashboardLink, onboardingLink, refreshStatus, syncAccount, } from './stripeConnect';

function siteUrl(path: string,): string {
    return `${((config.frontendUrl as string | undefined) ?? '').replace(/\/+$/, '',)}${path}`;
}

/** Does the user hold the affiliate role (main or additional)? */
export async function isAffiliate(userId: string,): Promise<boolean> {
    const { role, } = await getAffiliateSettings();
    const r = await query(`SELECT 1 FROM users WHERE id = $1 AND (role = $2 OR $2 = ANY(extra_roles))`, [userId, role,],);
    return r.rows.length > 0;
}

export async function assertAffiliate(userId: string | undefined,): Promise<string> {
    if (!userId || !await isAffiliate(userId,)) throw new ForbiddenError('You are not part of the affiliate program.',);
    return userId;
}

function toAffiliateCode(c: ShopDiscountCode,): AffiliateCode {
    return {
        id: c.id,
        code: c.code,
        active: c.active,
        commissionPercent: c.commissionPercent ?? 0,
        buyerDiscountPercent: c.percent,
        maxUses: c.maxUses,
        uses: c.uses,
        appliesToTickets: c.appliesToTickets,
        shareUrl: siteUrl(`/shop?code=${encodeURIComponent(c.code,)}`,),
    };
}

/** GET /affiliates/me — the affiliate's own page (no buyer details). */
export async function me(userId: string,): Promise<AffiliateMeResponse> {
    const [settings, acct, balance, codes, earnings, payouts,] = await Promise.all([
        getAffiliateSettings(), accountRow(userId,), balanceFor(userId,),
        discounts.list({ type: 'affiliate', affiliateUserId: userId, },), earningsFor(userId,), payoutsFor(userId,),
    ],);
    return {
        stripe: statusOf(acct,),
        balance,
        codes: codes.map(toAffiliateCode,),
        earnings,
        payouts,
        refundWindowDays: settings.refundWindowDays,
        payoutSchedule: settings.payoutSchedule,
    };
}

/** The affiliate sets how much of their commission buyers get as a discount. */
export async function setSplit(userId: string, codeId: string, buyerDiscountPercent: number, ctx: AuditContext,): Promise<AffiliateCode> {
    const code = await discounts.get(codeId,).catch(() => null,);
    if (!code || code.affiliateUserId !== userId) throw new NotFoundError('Code',);
    const ceiling = code.commissionPercent ?? 0;
    if (!(buyerDiscountPercent >= 0 && buyerDiscountPercent <= ceiling)) {
        throw new ValidationError(`Choose 0–${ceiling}% (your commission on this code).`,);
    }
    return toAffiliateCode(await discounts.update(codeId, { percent: buyerDiscountPercent, }, ctx,),);
}

// ─── Admin ────────────────────────────────────────────────────────────────

interface SalesRow { user_id: string; orders: string; sales: string; }

async function salesByAffiliate(userIds: string[],): Promise<Map<string, { orders: number; salesCents: number; }>> {
    if (!userIds.length) return new Map();
    const r = await query<SalesRow>(
        `SELECT c.affiliate_user_id AS user_id, COUNT(r.id) AS orders, COALESCE(SUM(r.merch_subtotal_cents), 0) AS sales
           FROM shop_discount_redemptions r JOIN shop_discount_codes c ON c.id = r.code_id
          WHERE r.status = 'paid' AND c.affiliate_user_id = ANY($1)
          GROUP BY c.affiliate_user_id`,
        [userIds,],
    );
    return new Map(r.rows.map((x,) => [x.user_id, { orders: Number(x.orders,), salesCents: Number(x.sales,), },]),);
}

/** Every user with the affiliate role (and anyone still holding an affiliate code). */
export async function members(): Promise<AffiliateMember[]> {
    const { role, } = await getAffiliateSettings();
    const users = await query<{ id: string; display_name: string; email: string; }>(
        `SELECT id, display_name, email FROM users
          WHERE role = $1 OR $1 = ANY(extra_roles)
             OR id IN (SELECT affiliate_user_id FROM shop_discount_codes WHERE affiliate_user_id IS NOT NULL AND deleted_at IS NULL)
          ORDER BY display_name LIMIT 1000`,
        [role,],
    );
    const ids = users.rows.map((u,) => u.id,);
    const [allCodes, sales,] = await Promise.all([discounts.list({ type: 'affiliate', },), salesByAffiliate(ids,),],);
    return Promise.all(users.rows.map(async (u,) => ({
        userId: u.id,
        displayName: u.display_name,
        email: u.email,
        stripe: statusOf(await accountRow(u.id,),),
        balance: await balanceFor(u.id,),
        codes: allCodes.filter((c,) => c.affiliateUserId === u.id,),
        orders: sales.get(u.id,)?.orders ?? 0,
        salesCents: sales.get(u.id,)?.salesCents ?? 0,
    })),);
}

export async function member(userId: string,): Promise<AffiliateMemberDetail> {
    const u = (await query<{ id: string; display_name: string; email: string; }>(`SELECT id, display_name, email FROM users WHERE id = $1`, [userId,],)).rows[0];
    if (!u) throw new NotFoundError('User',);
    const [codes, sales, acct, balance, earnings, payouts,] = await Promise.all([
        discounts.list({ type: 'affiliate', affiliateUserId: userId, },), salesByAffiliate([userId,],), accountRow(userId,),
        balanceFor(userId,), earningsFor(userId,), payoutsFor(userId,),
    ],);
    return {
        userId: u.id, displayName: u.display_name, email: u.email, stripe: statusOf(acct,), balance, codes,
        orders: sales.get(userId,)?.orders ?? 0, salesCents: sales.get(userId,)?.salesCents ?? 0, earnings, payouts,
    };
}

/** Admin: give an affiliate a code (commission defaults to the program setting). */
export async function createCode(userId: string, body: ShopDiscountCodeBody, ctx: AuditContext,): Promise<ShopDiscountCode> {
    const settings = await getAffiliateSettings();
    return discounts.create({
        ...body,
        kind: 'percent',
        percent: body.percent ?? 0,
        affiliateUserId: userId,
        commissionPercent: body.commissionPercent ?? settings.defaultCommissionPercent,
    }, ctx,);
}

/** Program-wide numbers for the Shop dashboard card. */
export async function stats(): Promise<AffiliateStats> {
    const { role, } = await getAffiliateSettings();
    const [m, s, e,] = await Promise.all([
        query<{ n: string; }>(`SELECT COUNT(*) AS n FROM users WHERE role = $1 OR $1 = ANY(extra_roles)`, [role,],),
        query<{ sales: string; }>(
            `SELECT COALESCE(SUM(r.merch_subtotal_cents), 0) AS sales FROM shop_discount_redemptions r
               JOIN shop_discount_codes c ON c.id = r.code_id
              WHERE r.status = 'paid' AND c.affiliate_user_id IS NOT NULL AND r.created_at > NOW() - INTERVAL '30 days'`,
        ),
        query<{ commission30: string; owed: string; available: string; currency: string | null; }>(
            `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE kind = 'commission' AND created_at > NOW() - INTERVAL '30 days' AND status <> 'reversed'), 0) AS commission30,
                    COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL), 0) AS owed,
                    COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at <= NOW()), 0) AS available,
                    MAX(currency) AS currency
               FROM affiliate_earnings`,
        ),
    ],);
    return {
        members: Number(m.rows[0]?.n ?? 0,),
        salesCents30d: Number(s.rows[0]?.sales ?? 0,),
        commissionCents30d: Number(e.rows[0]?.commission30 ?? 0,),
        owedCents: Number(e.rows[0]?.owed ?? 0,),
        availableCents: Number(e.rows[0]?.available ?? 0,),
        currency: e.rows[0]?.currency || 'usd',
    };
}
