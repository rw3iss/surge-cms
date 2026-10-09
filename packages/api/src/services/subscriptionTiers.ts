/**
 * Roles and subscription tiers.
 *
 * ROLES (`roles` table, migration 122): built-ins are locked; a custom role
 * inherits a base role's permissions (`subscriber` → `member`). A custom role's
 * base must itself be member-level — the route auth tiers compare BUILT-IN
 * names, so a custom role is always a member to them, and letting it claim a
 * staff base would advertise staff permissions it could never use.
 *
 * TIERS (`subscription_plans`): each gives its subscribers a role and may grant
 * extra permissions (`permission_grants` with subject_type `plan`). The `free`
 * tier is everyone without a paid subscription. A tier is bound to a recurring
 * price that already exists in Stripe (picked from the account, not created
 * here); its amount and interval are copied for display.
 *
 * ROLE SYNC: when a subscription starts, changes or ends (Stripe webhook or an
 * admin assignment), the user's role is set to their tier's role — never for
 * staff, whose role is not the subscription's business.
 */
import type {
    RoleCreateBody, RoleDef, RoleUpdateBody, StripeSubscriptionPricesResponse, SubscriptionTier,
    SubscriptionTierBody, SubscriptionTierOption, UserSubscriptionInfo,
} from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { ConflictError, NotFoundError, ValidationError, } from '../core/errors';
import { query, transaction, } from '../db';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import { getStripeClient, } from './payment/stripe';
import { ENTITLED_STATUSES, invalidatePermissionCache, invalidatePlan, invalidateRoles, } from './permissions';
import type { AuditContext, } from './types';

const BUILTIN = new Set(['anonymous', 'member', 'editor', 'admin', 'sysadmin',],);

// ─── Roles ───────────────────────────────────────────────────────────────

function mapRole(r: Record<string, unknown>,): RoleDef {
    return {
        key: String(r.key,),
        label: String(r.label,),
        description: (r.description as string | null) ?? null,
        baseRole: (r.base_role as string | null) ?? null,
        isSystem: Boolean(r.is_system,),
        sortOrder: Number(r.sort_order ?? 0,),
        userCount: r.user_count != null ? Number(r.user_count,) : undefined,
    };
}

export async function listRoles(): Promise<RoleDef[]> {
    const r = await query(
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role = r.key) AS user_count
           FROM roles r ORDER BY r.sort_order, r.label`,
    );
    return r.rows.map(mapRole,);
}

async function roleMap(): Promise<Map<string, RoleDef>> {
    return new Map((await listRoles()).map((r,) => [r.key, r,]),);
}

/** A custom role's base must be member-level all the way up. */
async function assertMemberLevelBase(base: string | null | undefined, self?: string,): Promise<void> {
    if (!base) return;
    const roles = await roleMap();
    let cur: string | null = base;
    const seen = new Set<string>();
    while (cur) {
        if (cur === self || seen.has(cur,)) throw new ValidationError('A role cannot inherit from itself.',);
        seen.add(cur,);
        if (!roles.has(cur,)) throw new ValidationError(`Unknown base role "${cur}".`,);
        if (isStaffRole(cur,)) throw new ValidationError('A custom role can only build on member-level roles (not editor/admin/sysadmin).',);
        cur = roles.get(cur,)!.baseRole;
    }
}

export async function createRole(body: RoleCreateBody, ctx: AuditContext,): Promise<RoleDef> {
    const key = body.key.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(key,)) throw new ValidationError('Role key: 2–32 lowercase letters, digits or _, starting with a letter.',);
    if (BUILTIN.has(key,)) throw new ValidationError(`"${key}" is a built-in role.`,);
    await assertMemberLevelBase(body.baseRole ?? 'member', key,);
    try {
        const r = await query(
            `INSERT INTO roles (key, label, description, base_role, is_system, sort_order)
             VALUES ($1, $2, $3, $4, false, 50) RETURNING *`,
            [key, body.label.trim(), body.description ?? null, body.baseRole ?? 'member',],
        );
        invalidateRoles();
        invalidatePermissionCache();
        await logAudit({ userId: ctx.userId, action: 'create', entityType: 'role', entityId: key, newValues: body as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
        return mapRole(r.rows[0],);
    } catch (e) {
        if ((e as { code?: string; }).code === '23505') throw new ConflictError(`Role "${key}" already exists.`,);
        throw e;
    }
}

export async function updateRole(key: string, body: RoleUpdateBody, ctx: AuditContext,): Promise<RoleDef> {
    const existing = (await roleMap()).get(key,);
    if (!existing) throw new NotFoundError('Role',);
    if (existing.isSystem) throw new ValidationError('Built-in roles cannot be changed.',);
    if (body.baseRole !== undefined) await assertMemberLevelBase(body.baseRole, key,);
    const r = await query(
        `UPDATE roles SET label = COALESCE($2, label), description = COALESCE($3, description),
                base_role = CASE WHEN $5 THEN $4 ELSE base_role END, updated_at = NOW()
          WHERE key = $1 RETURNING *`,
        [key, body.label?.trim() || null, body.description ?? null, body.baseRole ?? null, body.baseRole !== undefined,],
    );
    invalidateRoles();
    invalidatePermissionCache();
    await logAudit({ userId: ctx.userId, action: 'update', entityType: 'role', entityId: key, newValues: body as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return mapRole(r.rows[0],);
}

export async function deleteRole(key: string, ctx: AuditContext,): Promise<void> {
    const existing = (await roleMap()).get(key,);
    if (!existing) throw new NotFoundError('Role',);
    if (existing.isSystem) throw new ValidationError('Built-in roles cannot be deleted.',);
    if ((existing.userCount ?? 0) > 0) throw new ConflictError(`${existing.userCount} user(s) have this role — move them to another role first.`,);
    const used = await query(`SELECT name FROM subscription_plans WHERE role = $1`, [key,],);
    if (used.rows.length) throw new ConflictError(`The "${used.rows[0].name}" subscription gives this role — change it first.`,);
    await transaction(async (c,) => {
        await c.query(`DELETE FROM permission_grants WHERE subject_type = 'role' AND subject_id = $1`, [key,],);
        await c.query(`UPDATE roles SET base_role = 'member' WHERE base_role = $1`, [key,],);
        await c.query(`DELETE FROM roles WHERE key = $1`, [key,],);
    },);
    invalidateRoles();
    invalidatePermissionCache();
    await logAudit({ userId: ctx.userId, action: 'delete', entityType: 'role', entityId: key, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
}

/** Is `role` assignable to a user (exists)? */
export async function assertRoleExists(role: string,): Promise<void> {
    if (!(await roleMap()).has(role,)) throw new ValidationError(`Unknown role "${role}".`,);
}

// ─── Tiers ───────────────────────────────────────────────────────────────

const TIER_SELECT = `
    SELECT p.*,
           COALESCE((SELECT array_agg(g.permission_key ORDER BY g.permission_key)
                       FROM permission_grants g
                      WHERE g.subject_type = 'plan' AND g.subject_id = p.id::text AND g.granted), '{}') AS permission_keys,
           CASE WHEN p.is_free THEN
                (SELECT COUNT(*) FROM users u
                  WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = ANY($1)))
           ELSE (SELECT COUNT(DISTINCT s.user_id) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = ANY($1))
           END AS subscriber_count
      FROM subscription_plans p`;

function mapTier(r: Record<string, unknown>,): SubscriptionTier {
    return {
        id: String(r.id,),
        slug: String(r.slug ?? '',),
        name: String(r.name,),
        description: (r.description as string | null) ?? null,
        role: (r.role as string | null) ?? null,
        isFree: Boolean(r.is_free,),
        isActive: r.is_active !== false,
        priceCents: Number(r.price_cents ?? 0,),
        interval: String(r.interval ?? 'month',),
        stripePriceId: (r.stripe_price_id as string | null) ?? null,
        stripeProductId: (r.stripe_product_id as string | null) ?? null,
        sortOrder: Number(r.sort_order ?? 0,),
        permissions: (r.permission_keys as string[] | null) ?? [],
        subscriberCount: Number(r.subscriber_count ?? 0,),
    };
}

export async function listTiers(): Promise<SubscriptionTier[]> {
    const r = await query(`${TIER_SELECT} ORDER BY p.sort_order, p.created_at`, [ENTITLED_STATUSES,],);
    return r.rows.map(mapTier,);
}

/**
 * Tiers for a content-gating picker, lowest rank first. A gated item requires
 * a tier; a viewer passes with that tier or any tier ranked above it
 * (`sort_order`). Staff-safe: no prices, permissions or Stripe ids.
 */
export async function tierOptions(): Promise<SubscriptionTierOption[]> {
    const r = await query(
        `SELECT id, name, slug, is_free, is_active, sort_order FROM subscription_plans ORDER BY sort_order, created_at`,
    );
    return r.rows.map((t,) => ({
        id: t.id, name: t.name, slug: t.slug ?? null, isFree: t.is_free === true, isActive: t.is_active !== false,
        sortOrder: Number(t.sort_order ?? 0,),
    }));
}

export async function getTier(id: string,): Promise<SubscriptionTier> {
    const r = await query(`${TIER_SELECT} WHERE p.id = $2`, [ENTITLED_STATUSES, id,],);
    if (!r.rows[0]) throw new NotFoundError('Subscription',);
    return mapTier(r.rows[0],);
}

/** Copy a Stripe price's product / amount / interval onto a tier patch. */
async function stripePriceFields(priceId: string,): Promise<{ productId: string; amount: number; interval: string; }> {
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Stripe is not connected (Settings → Payments).',);
    const price = await stripe.prices.retrieve(priceId,);
    if (!price.recurring) throw new ValidationError('That Stripe price is not a recurring (subscription) price.',);
    return {
        productId: typeof price.product === 'string' ? price.product : price.product.id,
        amount: price.unit_amount ?? 0,
        interval: price.recurring.interval,
    };
}

async function setTierPermissions(client: { query: typeof query; }, tierId: string, keys: string[], userId: string | null,): Promise<void> {
    await client.query(`DELETE FROM permission_grants WHERE subject_type = 'plan' AND subject_id = $1`, [tierId,],);
    for (const key of [...new Set(keys,),]) {
        await client.query(
            `INSERT INTO permission_grants (permission_key, subject_type, subject_id, granted, created_by)
             SELECT $1, 'plan', $2, true, $3 WHERE EXISTS (SELECT 1 FROM permissions WHERE key = $1)`,
            [key, tierId, userId,],
        );
    }
}

/**
 * Tier RANK (`sort_order`) is automatic: free = 0, paid 1…N by monthly price,
 * cheapest first (equal prices share a rank). The post gate and the entity
 * `subscription` filter compare these. Same statement as migration 131.
 */
export const TIER_RANK_SQL = `
WITH monthly AS (
    SELECT id,
           COALESCE(is_free, false) AS free,
           COALESCE(price_cents, 0) * CASE lower(COALESCE("interval", 'month'))
               WHEN 'year' THEN 1.0 / 12 WHEN 'week' THEN 52.0 / 12 WHEN 'day' THEN 365.0 / 12 ELSE 1 END AS per_month
      FROM subscription_plans
), ranked AS (
    SELECT id, CASE WHEN free THEN 0 ELSE DENSE_RANK() OVER (PARTITION BY free ORDER BY per_month) END AS rank
      FROM monthly
)
UPDATE subscription_plans p
   SET sort_order = ranked.rank
  FROM ranked
 WHERE ranked.id = p.id AND p.sort_order IS DISTINCT FROM ranked.rank`;

async function invalidateGate(): Promise<void> {
    const { invalidateGateTiers, } = await import('./postGate/index.js');
    invalidateGateTiers();
    // The tier catalogue (/subscribe, profile Membership) caches Stripe
    // prices + descriptions for an hour — a tier change refreshes it.
    const { cache, } = await import('./cache.js');
    await cache.invalidateMembershipCache();
    // Ranks may have moved: cached post entity queries filtered by
    // `subscription` would otherwise keep the old ordering.
    await cache.invalidateEntityCache('post',);
}

export async function saveTier(id: string | null, body: SubscriptionTierBody, ctx: AuditContext,): Promise<SubscriptionTier> {
    if (body.role) await assertRoleExists(body.role,);
    if (body.role && isStaffRole(body.role,)) throw new ValidationError('A subscription cannot give a staff role.',);
    const slug = body.slug?.trim().toLowerCase();
    if (slug !== undefined && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug,)) throw new ValidationError('Slug: lowercase letters, digits and dashes.',);

    let stripe: { productId: string | null; amount: number | null; interval: string | null; } | null = null;
    if (body.stripePriceId !== undefined) {
        if (body.stripePriceId) {
            const f = await stripePriceFields(body.stripePriceId,);
            stripe = { productId: f.productId, amount: f.amount, interval: f.interval, };
        } else {
            stripe = { productId: null, amount: null, interval: null, };
        }
    }

    const tierId = await transaction(async (c,) => {
        let tid = id;
        if (!tid) {
            if (!body.name?.trim() || !slug) throw new ValidationError('Name and slug are required.',);
            const r = await c.query(
                `INSERT INTO subscription_plans (slug, name, description, role, is_active, price_cents, interval, stripe_price_id, stripe_product_id, sort_order)
                 VALUES ($1, $2, $3, $4, COALESCE($5, true), COALESCE($6, 0), COALESCE($7, 'month'), $8, $9, COALESCE($10, 50)) RETURNING id`,
                [slug, body.name.trim(), body.description ?? null, body.role ?? 'subscriber', body.isActive ?? null,
                    stripe?.amount ?? null, stripe?.interval ?? null, body.stripePriceId || null, stripe?.productId ?? null, body.sortOrder ?? null,],
            );
            tid = String(r.rows[0].id,);
        } else {
            const cur = await c.query(`SELECT is_free FROM subscription_plans WHERE id = $1`, [tid,],);
            if (!cur.rows[0]) throw new NotFoundError('Subscription',);
            if (cur.rows[0].is_free && body.stripePriceId) throw new ValidationError('The free tier has no Stripe price.',);
            await c.query(
                `UPDATE subscription_plans SET
                    slug = COALESCE($2, slug), name = COALESCE($3, name),
                    description = CASE WHEN $4 THEN $5 ELSE description END,
                    role = CASE WHEN $6 THEN $7 ELSE role END,
                    is_active = COALESCE($8, is_active),
                    stripe_price_id = CASE WHEN $9 THEN $10 ELSE stripe_price_id END,
                    stripe_product_id = CASE WHEN $9 THEN $11 ELSE stripe_product_id END,
                    price_cents = CASE WHEN $9 THEN COALESCE($12, 0) ELSE price_cents END,
                    interval = CASE WHEN $9 THEN COALESCE($13, interval) ELSE interval END,
                    sort_order = COALESCE($14, sort_order),
                    updated_at = NOW()
                  WHERE id = $1`,
                [tid, slug ?? null, body.name?.trim() || null, body.description !== undefined, body.description ?? null,
                    body.role !== undefined, body.role ?? null, body.isActive ?? null,
                    stripe !== null, body.stripePriceId || null, stripe?.productId ?? null, stripe?.amount ?? null, stripe?.interval ?? null,
                    body.sortOrder ?? null,],
            );
        }
        if (body.permissions) await setTierPermissions(c as never, tid, body.permissions, ctx.userId || null,);
        await c.query(TIER_RANK_SQL,);
        return tid;
    },).catch((e,) => {
        if ((e as { code?: string; }).code === '23505') throw new ConflictError('Another subscription already uses that slug (or Stripe price).',);
        throw e;
    },);

    invalidatePermissionCache();
    invalidatePlan();
    await logAudit({ userId: ctx.userId, action: id ? 'update' : 'create', entityType: 'subscription_tier', entityId: tierId, newValues: body as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    // A role change on the tier moves its current subscribers too.
    if (id && body.role !== undefined) await resyncTierSubscribers(tierId,);
    await invalidateGate();
    return getTier(tierId,);
}

export async function deleteTier(id: string, ctx: AuditContext,): Promise<void> {
    const t = await getTier(id,);
    if (t.isFree) throw new ValidationError('The free tier cannot be deleted.',);
    const any = await query(`SELECT 1 FROM subscriptions WHERE plan_id = $1 LIMIT 1`, [id,],);
    if (any.rows.length) throw new ConflictError('This subscription has (or had) subscribers — deactivate it instead.',);
    await transaction(async (c,) => {
        await c.query(`DELETE FROM permission_grants WHERE subject_type = 'plan' AND subject_id = $1`, [id,],);
        await c.query(`DELETE FROM subscription_plans WHERE id = $1`, [id,],);
        await c.query(TIER_RANK_SQL,);
    },);
    invalidatePermissionCache();
    invalidatePlan();
    await logAudit({ userId: ctx.userId, action: 'delete', entityType: 'subscription_tier', entityId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    await invalidateGate();
}

// ─── Stripe ──────────────────────────────────────────────────────────────

/** Every active recurring price in the connected (default) Stripe account. */
export async function stripePrices(): Promise<StripeSubscriptionPricesResponse> {
    const stripe = getStripeClient('default',);
    if (!stripe) return { connected: false, prices: [], };
    try {
        const prices = [];
        for await (const p of stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product',], limit: 100, },)) {
            const product = typeof p.product === 'string' ? null : p.product;
            if (product && 'deleted' in product && product.deleted) continue;
            prices.push({
                priceId: p.id,
                productId: typeof p.product === 'string' ? p.product : p.product.id,
                productName: product && 'name' in product ? product.name : (typeof p.product === 'string' ? p.product : ''),
                nickname: p.nickname ?? null,
                unitAmount: p.unit_amount ?? null,
                currency: p.currency,
                interval: p.recurring?.interval ?? 'month',
                intervalCount: p.recurring?.interval_count ?? 1,
            },);
            if (prices.length >= 500) break;
        }
        return { connected: true, prices, };
    } catch (e) {
        logger.warn('stripe prices list failed', { error: (e as Error).message, },);
        return { connected: true, prices: [], error: (e as Error).message, };
    }
}

// ─── Users ───────────────────────────────────────────────────────────────

export async function userSubscription(userId: string,): Promise<UserSubscriptionInfo> {
    const r = await query(
        `SELECT s.status, s.stripe_subscription_id, s.current_period_end, s.cancel_at_period_end,
                p.id, p.slug, p.name, p.role, p.is_free
           FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.user_id = $1 AND s.status = ANY($2)
          ORDER BY s.created_at DESC LIMIT 1`,
        [userId, ENTITLED_STATUSES,],
    );
    const row = r.rows[0];
    if (row) {
        return {
            tier: { id: row.id, slug: row.slug, name: row.name, role: row.role, isFree: row.is_free, },
            status: row.status,
            source: row.stripe_subscription_id ? 'stripe' : 'manual',
            currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end,).toISOString() : null,
            cancelAtPeriodEnd: Boolean(row.cancel_at_period_end,),
        };
    }
    const free = await query(`SELECT id, slug, name, role, is_free FROM subscription_plans WHERE is_free LIMIT 1`,);
    const f = free.rows[0];
    return {
        tier: f ? { id: f.id, slug: f.slug, name: f.name, role: f.role, isFree: true, } : null,
        status: null, source: 'free', currentPeriodEnd: null, cancelAtPeriodEnd: false,
    };
}

/** Put the user's role in line with their tier (staff are left alone). */
export async function syncUserRole(userId: string,): Promise<void> {
    invalidatePlan(userId,);
    const u = await query<{ role: string; }>(`SELECT role FROM users WHERE id = $1`, [userId,],);
    const current = u.rows[0]?.role;
    if (!current || isStaffRole(current,)) return;
    const info = await userSubscription(userId,);
    const target = info.tier?.role || 'member';
    if (target !== current) {
        await query(`UPDATE users SET role = $2, updated_at = NOW() WHERE id = $1`, [userId, target,],);
        logger.info('subscription role sync', { userId, from: current, to: target, },);
    }
}

async function resyncTierSubscribers(tierId: string,): Promise<void> {
    const r = await query<{ user_id: string; }>(
        `SELECT DISTINCT user_id FROM subscriptions WHERE plan_id = $1 AND status = ANY($2)`,
        [tierId, ENTITLED_STATUSES,],
    );
    for (const row of r.rows) await syncUserRole(row.user_id,);
}

/** Sync the role of whoever owns a Stripe subscription (webhook path). */
export async function syncByStripeSubscription(stripeSubscriptionId: string,): Promise<void> {
    const r = await query<{ user_id: string; }>(`SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1`, [stripeSubscriptionId,],);
    if (r.rows[0]) await syncUserRole(r.rows[0].user_id,);
}

/**
 * Admin assignment without Stripe (a comp, a grandfathered member, a YouTube
 * or Patreon supporter reconciled by hand). Ends any active MANUAL
 * subscription and, unless the target is the free tier, starts a new one.
 * A Stripe subscription is never touched here — cancel it in Stripe.
 */
export async function assignTier(userId: string, tierId: string | null, ctx: AuditContext,): Promise<UserSubscriptionInfo> {
    const user = await query(`SELECT id FROM users WHERE id = $1`, [userId,],);
    if (!user.rows[0]) throw new NotFoundError('User',);
    const tier = tierId ? await getTier(tierId,) : null;
    const stripeActive = await query(
        `SELECT 1 FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL AND status = ANY($2) LIMIT 1`,
        [userId, ENTITLED_STATUSES,],
    );
    if (stripeActive.rows.length) throw new ConflictError('This user pays through Stripe — change or cancel that subscription in Stripe.',);
    await transaction(async (c,) => {
        await c.query(
            `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
              WHERE user_id = $1 AND stripe_subscription_id IS NULL AND status = ANY($2)`,
            [userId, ENTITLED_STATUSES,],
        );
        if (tier && !tier.isFree) {
            await c.query(`INSERT INTO subscriptions (user_id, plan_id, status, current_period_start) VALUES ($1, $2, 'active', NOW())`, [userId, tier.id,],);
        }
    },);
    await syncUserRole(userId,);
    await logAudit({ userId: ctx.userId, action: 'assign_subscription', entityType: 'user', entityId: userId, newValues: { tierId: tier?.id ?? null, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return userSubscription(userId,);
}
