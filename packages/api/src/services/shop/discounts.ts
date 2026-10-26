/**
 * Shop discount codes — ONE engine for site-wide codes and affiliate codes.
 *
 *   - Admin CRUD (`/shop/discounts`, `shop.discounts:manage`).
 *   - `applyDiscount` — the checkout hook: validates a code for the buyer and
 *     the cart (window, uses left, who may use it, minimum) and returns the
 *     discount, spread over the eligible lines for tax.
 *   - `recordRedemption` / `markOrderRefunded` — fulfilment + refund: a use
 *     is a PAID order (`shop_discount_redemptions`); usage is always COUNTED
 *     from those rows, never kept as a counter.
 *
 * An affiliate code = a code with `affiliate_user_id` + `commission_percent`;
 * its commission is recorded by `services/affiliates` (feature `affiliates`).
 * Maths: `@sitesurge/types` `utils/discountMath.ts`.
 */
import type {
    ShopDiscountCheckResponse, ShopDiscountCode, ShopDiscountCodeBody, ShopDiscountListQuery, ShopDiscountRedemption,
} from '@sitesurge/types';
import { discountCentsFor, discountSummary, distributeDiscount, merchandiseSubtotal, type DiscountLine, type DiscountRule, } from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { ConflictError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import type { LevelViewer, } from '../access/level';
import { viewerGrants, } from '../access/grants';
import { logAudit, } from '../audit';
import { can, } from '../permissions';
import { isFeatureEnabledServer, } from '../settings';
import type { AuditContext, } from '../types';

export interface CodeRow {
    id: string;
    code: string;
    kind: 'percent' | 'fixed';
    percent: string | number;
    amount_cents: number;
    active: boolean;
    starts_at: Date | null;
    ends_at: Date | null;
    max_uses: number | null;
    max_uses_per_user: number | null;
    min_subtotal_cents: number | null;
    allowed_tier_ids: string[] | null;
    allowed_roles: string[] | null;
    applies_to_tickets: boolean;
    affiliate_user_id: string | null;
    commission_percent: string | number | null;
    note: string | null;
    created_at: Date;
    updated_at: Date;
    uses?: string | number;
    affiliate_name?: string | null;
    affiliate_email?: string | null;
}

/** Minutes an unpaid checkout holds a use of a limited code. */
const PENDING_HOLD_MINUTES = 30;

const iso = (d: Date | null,) => (d ? new Date(d,).toISOString() : null);
const num = (v: string | number | null | undefined,) => (v == null ? null : Number(v,));

export function mapCode(r: CodeRow,): ShopDiscountCode {
    return {
        id: r.id,
        code: r.code,
        kind: r.kind,
        percent: Number(r.percent ?? 0,),
        amountCents: r.amount_cents ?? 0,
        active: r.active,
        startsAt: iso(r.starts_at,),
        endsAt: iso(r.ends_at,),
        maxUses: r.max_uses,
        maxUsesPerUser: r.max_uses_per_user,
        minSubtotalCents: r.min_subtotal_cents,
        allowedTierIds: r.allowed_tier_ids ?? [],
        allowedRoles: r.allowed_roles ?? [],
        appliesToTickets: r.applies_to_tickets,
        affiliateUserId: r.affiliate_user_id,
        affiliate: r.affiliate_user_id
            ? { id: r.affiliate_user_id, displayName: r.affiliate_name ?? '', email: r.affiliate_email ?? '', }
            : null,
        commissionPercent: num(r.commission_percent,),
        note: r.note,
        uses: Number(r.uses ?? 0,),
        createdAt: new Date(r.created_at,).toISOString(),
        updatedAt: new Date(r.updated_at,).toISOString(),
    };
}

export function ruleOf(r: Pick<CodeRow, 'kind' | 'percent' | 'amount_cents' | 'applies_to_tickets'>,): DiscountRule {
    return { kind: r.kind, percent: Number(r.percent ?? 0,), amountCents: r.amount_cents ?? 0, appliesToTickets: r.applies_to_tickets, };
}

const SELECT = `
    SELECT c.*, u.display_name AS affiliate_name, u.email AS affiliate_email,
           (SELECT COUNT(*) FROM shop_discount_redemptions r WHERE r.code_id = c.id AND r.status = 'paid') AS uses
      FROM shop_discount_codes c
      LEFT JOIN users u ON u.id = c.affiliate_user_id`;

// ─── Admin CRUD ───────────────────────────────────────────────────────────

export async function list(q: ShopDiscountListQuery = {},): Promise<ShopDiscountCode[]> {
    const where = ['c.deleted_at IS NULL',];
    const params: unknown[] = [];
    if (q.type === 'site') where.push('c.affiliate_user_id IS NULL',);
    if (q.type === 'affiliate') where.push('c.affiliate_user_id IS NOT NULL',);
    if (q.affiliateUserId) { params.push(q.affiliateUserId,); where.push(`c.affiliate_user_id = $${params.length}`,); }
    if (q.search) { params.push(`%${q.search.toLowerCase()}%`,); where.push(`lower(c.code) LIKE $${params.length}`,); }
    const r = await query<CodeRow>(`${SELECT} WHERE ${where.join(' AND ',)} ORDER BY c.created_at DESC LIMIT 500`, params,);
    return r.rows.map(mapCode,);
}

export async function get(id: string,): Promise<ShopDiscountCode> {
    const r = await query<CodeRow>(`${SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Discount code',);
    return mapCode(r.rows[0],);
}

/** Paid uses of a code (admin detail), newest first. */
export async function redemptions(id: string,): Promise<ShopDiscountRedemption[]> {
    const r = await query<{ order_id: string; order_number: string; discount_cents: number; merch_subtotal_cents: number; status: 'paid' | 'refunded'; created_at: Date; }>(
        `SELECT r.order_id, o.order_number, r.discount_cents, r.merch_subtotal_cents, r.status, r.created_at
           FROM shop_discount_redemptions r JOIN shop_orders o ON o.id = r.order_id
          WHERE r.code_id = $1 ORDER BY r.created_at DESC LIMIT 200`,
        [id,],
    );
    return r.rows.map((x,) => ({
        orderId: x.order_id, orderNumber: x.order_number, discountCents: x.discount_cents,
        merchSubtotalCents: x.merch_subtotal_cents, status: x.status, createdAt: new Date(x.created_at,).toISOString(),
    }));
}

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;

/** Validate + normalise a create/update body against the code it updates (if any). */
export function normalizeBody(body: ShopDiscountCodeBody, existing?: ShopDiscountCode,): ShopDiscountCodeBody {
    const out: ShopDiscountCodeBody = { ...body, };
    if (out.code !== undefined) {
        out.code = out.code.trim();
        if (!CODE_RE.test(out.code,)) throw new ValidationError('Code: 3–64 letters, digits, - or _, starting with a letter or digit.',);
    }
    const pct = (v: number | null | undefined, name: string,) => {
        if (v == null) return;
        if (!Number.isFinite(v,) || v < 0 || v > 100) throw new ValidationError(`${name} must be between 0 and 100.`,);
    };
    pct(out.percent, 'Percent',);
    pct(out.commissionPercent, 'Commission',);
    if (out.amountCents != null && (!Number.isInteger(out.amountCents,) || out.amountCents < 0)) throw new ValidationError('Amount must be 0 or more.',);
    const affiliate = out.affiliateUserId !== undefined ? out.affiliateUserId : existing?.affiliateUserId ?? null;
    const kind = out.kind ?? existing?.kind ?? 'percent';
    if (affiliate) {
        if (kind !== 'percent') throw new ValidationError('An affiliate code gives a percent discount.',);
        const commission = out.commissionPercent !== undefined ? out.commissionPercent : existing?.commissionPercent ?? null;
        if (commission == null) out.commissionPercent = 10;
        const buyer = out.percent ?? existing?.percent ?? 0;
        const ceiling = out.commissionPercent ?? commission ?? 10;
        if (buyer > ceiling) throw new ValidationError('The buyer discount cannot be more than the affiliate commission (it is paid out of it).',);
    }
    const starts = out.startsAt !== undefined ? out.startsAt : existing?.startsAt;
    const ends = out.endsAt !== undefined ? out.endsAt : existing?.endsAt;
    if (starts && ends && Date.parse(ends,) <= Date.parse(starts,)) throw new ValidationError('The end date must be after the start date.',);
    return out;
}

const COLUMNS: Record<keyof ShopDiscountCodeBody, string> = {
    code: 'code', kind: 'kind', percent: 'percent', amountCents: 'amount_cents', active: 'active',
    startsAt: 'starts_at', endsAt: 'ends_at', maxUses: 'max_uses', maxUsesPerUser: 'max_uses_per_user',
    minSubtotalCents: 'min_subtotal_cents', allowedTierIds: 'allowed_tier_ids', allowedRoles: 'allowed_roles',
    appliesToTickets: 'applies_to_tickets', affiliateUserId: 'affiliate_user_id', commissionPercent: 'commission_percent', note: 'note',
};

function duplicate(e: unknown,): never {
    if ((e as { code?: string; }).code === '23505') throw new ConflictError('A code with that name already exists.',);
    throw e;
}

export async function create(body: ShopDiscountCodeBody, ctx: AuditContext,): Promise<ShopDiscountCode> {
    if (!body.code) throw new ValidationError('Enter a code.',);
    const b = normalizeBody(body,);
    const keys = (Object.keys(COLUMNS,) as (keyof ShopDiscountCodeBody)[]).filter((k,) => b[k] !== undefined,);
    const cols = [...keys.map((k,) => COLUMNS[k],), 'created_by',];
    const vals = [...keys.map((k,) => b[k],), ctx.userId || null,];
    const r = await query<{ id: string; }>(
        `INSERT INTO shop_discount_codes (${cols.join(', ',)}) VALUES (${cols.map((_, i,) => `$${i + 1}`,).join(', ',)}) RETURNING id`,
        vals,
    ).catch(duplicate,);
    await logAudit({ userId: ctx.userId, action: 'create', entityType: 'shop_discount_code', entityId: r.rows[0].id, newValues: b as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(r.rows[0].id,);
}

export async function update(id: string, body: ShopDiscountCodeBody, ctx: AuditContext,): Promise<ShopDiscountCode> {
    const existing = await get(id,);
    const b = normalizeBody(body, existing,);
    const keys = (Object.keys(COLUMNS,) as (keyof ShopDiscountCodeBody)[]).filter((k,) => b[k] !== undefined,);
    if (keys.length) {
        await query(
            `UPDATE shop_discount_codes SET ${keys.map((k, i,) => `${COLUMNS[k]} = $${i + 2}`,).join(', ',)}, updated_at = NOW() WHERE id = $1`,
            [id, ...keys.map((k,) => b[k],),],
        ).catch(duplicate,);
    }
    await logAudit({ userId: ctx.userId, action: 'update', entityType: 'shop_discount_code', entityId: id, newValues: b as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(id,);
}

/** Delete = soft (orders keep their code and its history). */
export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    const r = await query(`UPDATE shop_discount_codes SET deleted_at = NOW(), active = false, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id,],);
    if (!r.rowCount) throw new NotFoundError('Discount code',);
    await logAudit({ userId: ctx.userId, action: 'delete', entityType: 'shop_discount_code', entityId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
}

// ─── Checkout ─────────────────────────────────────────────────────────────

export interface AppliedDiscount {
    codeId: string;
    code: string;
    discountCents: number;
    /** Per cart line (DiscountLine.key) — for tax on discounted amounts. */
    perLine: Map<string, number>;
    summary: string;
}

export interface ApplyOpts {
    /** The buyer's email (per-buyer limit for guests). */
    email?: string | null;
    /** In the order transaction: lock the code row while counting uses. */
    client?: PoolClient;
    currency?: string;
}

/** Why a code can't be used (pure: window / limits / who / cart). Null = usable. */
export function codeProblem(
    row: Pick<CodeRow, 'active' | 'starts_at' | 'ends_at' | 'max_uses' | 'max_uses_per_user' | 'min_subtotal_cents' | 'allowed_tier_ids' | 'allowed_roles'>,
    ctx: { now: Date; uses: number; userUses: number; signedIn: boolean; roles: string[]; tierIds: string[]; eligibleSubtotal: number; },
    currencyFmt: (c: number,) => string = (c,) => `$${(c / 100).toFixed(2,)}`,
): string | null {
    if (!row.active) return 'This code is not active.';
    if (row.starts_at && new Date(row.starts_at,) > ctx.now) return 'This code is not active yet.';
    if (row.ends_at && new Date(row.ends_at,) <= ctx.now) return 'This code has expired.';
    if (row.max_uses != null && ctx.uses >= row.max_uses) return 'This code has been used up.';
    if (row.max_uses_per_user != null && ctx.userUses >= row.max_uses_per_user) return 'You have already used this code.';
    const tiers = row.allowed_tier_ids ?? [];
    const roles = row.allowed_roles ?? [];
    if (tiers.length || roles.length) {
        if (!ctx.signedIn) return 'Sign in to use this code.';
        const ok = tiers.some((t,) => ctx.tierIds.includes(t,),) || roles.some((r,) => ctx.roles.includes(r,),);
        if (!ok) return 'This code is for members only.';
    }
    if (row.min_subtotal_cents != null && ctx.eligibleSubtotal < row.min_subtotal_cents) {
        return `This code needs an order of ${currencyFmt(row.min_subtotal_cents,)} or more.`;
    }
    return null;
}

async function findRow(code: string, client?: PoolClient,): Promise<CodeRow | null> {
    const sql = `SELECT * FROM shop_discount_codes WHERE lower(code) = lower($1) AND deleted_at IS NULL LIMIT 1${client ? ' FOR UPDATE' : ''}`;
    const r = client ? await client.query<CodeRow>(sql, [code.trim(),],) : await query<CodeRow>(sql, [code.trim(),],);
    return r.rows[0] ?? null;
}

async function countUses(row: CodeRow, userId: string | null, email: string | null, client?: PoolClient,): Promise<{ uses: number; userUses: number; }> {
    const q = <T extends Record<string, unknown>,>(sql: string, p: unknown[],) => (client ? client.query<T>(sql, p,) : query<T>(sql, p,));
    // Paid uses, plus recent unpaid checkouts holding the code (so a limited
    // code cannot be oversold by several buyers paying at once).
    const total = await q<{ n: string; }>(
        `SELECT (SELECT COUNT(*) FROM shop_discount_redemptions WHERE code_id = $1 AND status = 'paid')
              + (SELECT COUNT(*) FROM shop_orders o WHERE o.discount_code_id = $1 AND o.status = 'pending'
                   AND o.created_at > NOW() - make_interval(mins => $2)
                   AND NOT EXISTS (SELECT 1 FROM shop_discount_redemptions r WHERE r.order_id = o.id)) AS n`,
        [row.id, PENDING_HOLD_MINUTES,],
    );
    let userUses = 0;
    if (row.max_uses_per_user != null && (userId || email)) {
        const u = await q<{ n: string; }>(
            `SELECT COUNT(*) AS n FROM shop_discount_redemptions
              WHERE code_id = $1 AND status = 'paid' AND (($2::uuid IS NOT NULL AND user_id = $2::uuid) OR ($3::text IS NOT NULL AND lower(email) = lower($3)))`,
            [row.id, userId, email,],
        );
        userUses = Number(u.rows[0]?.n ?? 0,);
    }
    return { uses: Number(total.rows[0]?.n ?? 0,), userUses, };
}

/**
 * Apply a code to a cart. Returns `{ applied }` or `{ error }` (a message for
 * the buyer) — never throws for an unusable code.
 */
export async function applyDiscount(
    codeInput: string,
    lines: DiscountLine[],
    viewer: LevelViewer,
    opts: ApplyOpts = {},
): Promise<{ applied?: AppliedDiscount; error?: string; }> {
    const code = codeInput.trim();
    if (!code) return {};
    // `shop.discounts:use` (everyone by default) — an operator can withhold codes from a role.
    if (!await can({ id: viewer?.id ?? null, role: viewer?.role ?? 'anonymous', }, 'shop.discounts:use',).catch(() => true,)) {
        return { error: 'Discount codes are not available for your account.', };
    }
    const row = await findRow(code, opts.client,);
    if (!row) return { error: 'That code is not valid.', };
    const rule = ruleOf(row,);
    const eligibleSubtotal = lines.filter((l,) => !l.ticket || rule.appliesToTickets,).reduce((s, l,) => s + l.subtotalCents, 0,);
    const grants = await viewerGrants(viewer,);
    const { uses, userUses, } = await countUses(row, viewer?.id ?? null, opts.email ?? null, opts.client,);
    const problem = codeProblem(row, {
        now: new Date(), uses, userUses, signedIn: grants.signedIn, roles: grants.roles, tierIds: grants.tierIds, eligibleSubtotal,
    },);
    if (problem) return { error: problem, };
    const discountCents = discountCentsFor(rule, lines,);
    if (discountCents <= 0) {
        return { error: rule.appliesToTickets ? 'This code does not apply to anything in your cart.' : 'This code applies to merchandise only.', };
    }
    return {
        applied: {
            codeId: row.id,
            code: row.code,
            discountCents,
            perLine: distributeDiscount(lines, rule, discountCents,),
            summary: discountSummary(rule, opts.currency,),
        },
    };
}

/** POST /shop/discounts/check — a quick "is this code usable by me" (no cart). */
export async function check(code: string, viewer: LevelViewer,): Promise<ShopDiscountCheckResponse> {
    const row = await findRow(code,);
    if (!row) return { valid: false, message: 'That code is not valid.', };
    const grants = await viewerGrants(viewer,);
    const { uses, userUses, } = await countUses(row, viewer?.id ?? null, null,);
    const problem = codeProblem(row, {
        now: new Date(), uses, userUses, signedIn: grants.signedIn, roles: grants.roles, tierIds: grants.tierIds, eligibleSubtotal: Number.MAX_SAFE_INTEGER,
    },);
    return problem ? { valid: false, code: row.code, message: problem, } : { valid: true, code: row.code, summary: discountSummary(ruleOf(row,),), };
}

// ─── Fulfilment + refunds ─────────────────────────────────────────────────

/**
 * A paid order that used a code: record the use (idempotent) and, for an
 * affiliate code, the affiliate's commission. Called after the order is
 * marked paid; never throws (the payment already happened).
 */
export async function recordRedemption(orderId: string,): Promise<void> {
    try {
        const o = (await query<{ discount_code_id: string | null; discount_cents: number; user_id: string | null; customer_email: string | null; currency: string; created_at: Date; }>(
            `SELECT discount_code_id, discount_cents, user_id, customer_email, currency, created_at FROM shop_orders WHERE id = $1`, [orderId,],
        )).rows[0];
        if (!o?.discount_code_id) return;
        const items = await query<{ subtotal_cents: number; metadata: { kind?: string; } | null; }>(
            `SELECT subtotal_cents, metadata FROM shop_order_items WHERE order_id = $1`, [orderId,],
        );
        const merch = merchandiseSubtotal(items.rows.map((i, k,) => ({ key: String(k,), subtotalCents: i.subtotal_cents, ticket: i.metadata?.kind === 'event_ticket', })),);
        const ins = await query(
            `INSERT INTO shop_discount_redemptions (code_id, order_id, user_id, email, discount_cents, merch_subtotal_cents)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (order_id) DO NOTHING`,
            [o.discount_code_id, orderId, o.user_id, o.customer_email, o.discount_cents ?? 0, merch,],
        );
        if (!ins.rowCount) return; // already recorded (webhook retry)
        const code = (await query<{ affiliate_user_id: string | null; commission_percent: string | null; percent: string; }>(
            `SELECT affiliate_user_id, commission_percent, percent FROM shop_discount_codes WHERE id = $1`, [o.discount_code_id,],
        )).rows[0];
        if (code?.affiliate_user_id && await isFeatureEnabledServer('affiliates',)) {
            const { recordCommission, } = await import('../affiliates/earnings.js');
            await recordCommission({
                orderId, codeId: o.discount_code_id, userId: code.affiliate_user_id, merchSubtotalCents: merch,
                commissionPercent: Number(code.commission_percent ?? 0,), buyerDiscountPercent: Number(code.percent ?? 0,), currency: o.currency,
            },);
        }
    } catch (err) {
        logger.error('Discount redemption / commission could not be recorded', { orderId, error: err, },);
    }
}

/** A refunded order: its use no longer counts, and an affiliate commission is reversed. */
export async function markOrderRefunded(orderId: string,): Promise<void> {
    try {
        await query(`UPDATE shop_discount_redemptions SET status = 'refunded' WHERE order_id = $1`, [orderId,],);
        if (await isFeatureEnabledServer('affiliates',)) {
            const { reverseCommission, } = await import('../affiliates/earnings.js');
            await reverseCommission(orderId,);
        }
    } catch (err) {
        logger.error('Discount refund bookkeeping failed', { orderId, error: err, },);
    }
}
