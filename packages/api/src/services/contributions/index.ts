/**
 * CONTRIBUTOR compensation. A contributed post (submitted for review by a
 * contributor, or one an admin credited) earns the default payout when an
 * admin approves it — or an override. Until the money is PAID an admin may
 * change the amount or revoke it. Payouts go through the shared partner layer
 * (services/partners: Stripe Connect Express, `affiliate_payouts.source =
 * 'contribution'`). Guide: docs/how-it-works/CONTRIBUTOR-PAYOUTS.md.
 */
import type {
    Contribution, ContributionEarning, ContributionListQuery, ContributionPayoutsResponse, ContributionState, ContributionSummary,
    ContributorBalance, PartnerMeResponse,
} from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import { sendPurposeMail, } from '../mail/purposes';
import { buildNotification, notifyUser, notifyWith, personLabel, siteBaseUrl, } from '../notifications';
import { payableUsers, payOutSource, } from '../partners/payouts';
import { accountRow, statusOf, } from '../partners/stripeConnect';
import { can, } from '../permissions';
import * as posts from '../posts';
import type { AuditContext, } from '../types';
import { isPayoutDue, } from '../affiliates/schedule';
import { getContributorSettings, markContributorAutoPayoutRun, } from './settings';

export * from './settings';

const STATE_SQL = `CASE
    WHEN p.status = 'pending_review' THEN 'pending_review'
    WHEN e.status = 'revoked' THEN 'revoked'
    WHEN e.status = 'paid' THEN 'paid'
    WHEN p.status IN ('published', 'scheduled') OR e.id IS NOT NULL THEN 'approved'
    ELSE 'returned' END`;

/** A contributed post: submitted for review, or credited with an earning. */
const BASE_FROM = `FROM posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN contribution_earnings e ON e.post_id = p.id
    LEFT JOIN affiliate_payouts po ON po.id = e.payout_id
    WHERE (p.submitted_at IS NOT NULL OR e.id IS NOT NULL) AND p.status <> 'deleted'`;

const SORTS: Record<string, string> = {
    submitted_desc: 'COALESCE(p.submitted_at, p.created_at) DESC',
    submitted_asc: 'COALESCE(p.submitted_at, p.created_at) ASC',
    title_asc: 'p.title ASC',
    title_desc: 'p.title DESC',
    amount_desc: 'e.amount_cents DESC NULLS LAST',
    amount_asc: 'e.amount_cents ASC NULLS LAST',
    author_asc: 'u.display_name ASC NULLS LAST',
    author_desc: 'u.display_name DESC NULLS LAST',
    updated_desc: 'p.updated_at DESC',
};

type Row = {
    id: string; title: string; slug: string; status: string; state: ContributionState; submitted_at: Date | null; reviewed_at: Date | null;
    review_note: string | null; updated_at: Date; author_id: string | null; author_name: string | null; author_email: string | null;
    e_id: string | null; e_amount: number | null; e_currency: string | null; e_status: string | null; e_available_at: Date | null; e_created_at: Date | null;
    paid_at: Date | null;
};

const iso = (d: Date | null,) => (d ? new Date(d,).toISOString() : null);

function earningOf(r: Pick<Row, 'e_id' | 'e_amount' | 'e_currency' | 'e_status' | 'e_available_at' | 'e_created_at' | 'paid_at'>,): ContributionEarning | null {
    if (!r.e_id) return null;
    const status = r.e_status === 'paid' ? 'paid' : r.e_status === 'revoked' ? 'revoked'
        : new Date(r.e_available_at!,).getTime() > Date.now() ? 'pending' : 'available';
    return {
        id: r.e_id, amountCents: r.e_amount ?? 0, currency: r.e_currency || 'usd', status,
        availableAt: iso(r.e_available_at,)!, paidAt: iso(r.paid_at,), createdAt: iso(r.e_created_at,)!,
    };
}

function toContribution(r: Row,): Contribution {
    return {
        postId: r.id, title: r.title, slug: r.slug, postStatus: r.status, state: r.state,
        author: r.author_id ? { id: r.author_id, name: r.author_name ?? '', email: r.author_email ?? '', } : null,
        submittedAt: iso(r.submitted_at,), reviewedAt: iso(r.reviewed_at,), reviewNote: r.review_note, updatedAt: iso(r.updated_at,)!,
        earning: earningOf(r,),
    };
}

const SELECT = `SELECT p.id, p.title, p.slug, p.status, ${STATE_SQL} AS state, p.submitted_at, p.reviewed_at, p.review_note, p.updated_at,
    p.author_id, u.display_name AS author_name, u.email AS author_email,
    e.id AS e_id, e.amount_cents AS e_amount, e.currency AS e_currency, e.status AS e_status, e.available_at AS e_available_at, e.created_at AS e_created_at,
    CASE WHEN e.status = 'paid' THEN po.updated_at END AS paid_at`;

/** Admin: contributed posts, filterable + sortable + paginated. */
export async function list(q: ContributionListQuery,): Promise<{ data: Contribution[]; total: number; page: number; limit: number; }> {
    const params: unknown[] = [];
    let where = '';
    if (q.state && q.state !== 'all') { params.push(q.state,); where += ` AND ${STATE_SQL} = $${params.length}`; }
    if (q.authorId) { params.push(q.authorId,); where += ` AND p.author_id = $${params.length}`; }
    if (q.search?.trim()) { params.push(`%${q.search.trim()}%`,); where += ` AND (p.title ILIKE $${params.length} OR u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`; }
    const page = Math.max(1, Number(q.page ?? 1,),);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20,),),);
    const order = SORTS[q.sort ?? ''] ?? SORTS.submitted_desc;
    const total = Number((await query<{ n: string; }>(`SELECT COUNT(*) AS n ${BASE_FROM}${where}`, params,)).rows[0]?.n ?? 0,);
    const r = await query<Row>(`${SELECT} ${BASE_FROM}${where} ORDER BY ${order}, p.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params,);
    return { data: r.rows.map(toContribution,), total, page, limit, };
}

async function contributorRows(userIds?: string[],): Promise<ContributorBalance[]> {
    const params: unknown[] = [];
    let filter = '';
    if (userIds?.length) { params.push(userIds,); filter = ` AND p.author_id = ANY($1::uuid[])`; }
    const r = await query<{
        user_id: string; name: string | null; email: string; approved: string; pending_review: string;
        pending: string; available: string; paid: string; stripe_account_id: string | null; details_submitted: boolean | null; payouts_enabled: boolean | null;
    }>(
        `SELECT p.author_id AS user_id, MAX(u.display_name) AS name, MAX(u.email) AS email,
                COUNT(*) FILTER (WHERE ${STATE_SQL} IN ('approved', 'paid')) AS approved,
                COUNT(*) FILTER (WHERE p.status = 'pending_review') AS pending_review,
                COALESCE(SUM(e.amount_cents) FILTER (WHERE e.status = 'earned' AND e.available_at > NOW()), 0) AS pending,
                COALESCE(SUM(e.amount_cents) FILTER (WHERE e.status = 'earned' AND e.payout_id IS NULL AND e.available_at <= NOW()), 0) AS available,
                COALESCE(SUM(e.amount_cents) FILTER (WHERE e.status = 'paid'), 0) AS paid,
                MAX(a.stripe_account_id) AS stripe_account_id, BOOL_OR(a.details_submitted) AS details_submitted, BOOL_OR(a.payouts_enabled) AS payouts_enabled
           FROM posts p
           LEFT JOIN users u ON u.id = p.author_id
           LEFT JOIN contribution_earnings e ON e.post_id = p.id
           LEFT JOIN affiliate_accounts a ON a.user_id = p.author_id
          WHERE (p.submitted_at IS NOT NULL OR e.id IS NOT NULL) AND p.status <> 'deleted' AND p.author_id IS NOT NULL${filter}
          GROUP BY p.author_id`,
        params,
    );
    return r.rows.map((x,) => ({
        userId: x.user_id, name: x.name ?? '', email: x.email, approvedCount: Number(x.approved,), pendingReviewCount: Number(x.pending_review,),
        pendingCents: Number(x.pending,), availableCents: Number(x.available,), paidCents: Number(x.paid,),
        stripe: statusOf(x.stripe_account_id ? { user_id: x.user_id, stripe_account_id: x.stripe_account_id, details_submitted: !!x.details_submitted, payouts_enabled: !!x.payouts_enabled, } : null,),
    }));
}

/** Admin: counts by state, money owed / payable / paid, and every contributor's balance. */
export async function summary(): Promise<ContributionSummary> {
    const s = await getContributorSettings();
    const counts = await query<{ state: ContributionState; n: string; }>(`SELECT ${STATE_SQL} AS state, COUNT(*) AS n ${BASE_FROM} GROUP BY 1`,);
    const money = await query<{ owed: string; payable: string; paid: string; }>(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned'), 0) AS owed,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at <= NOW()), 0) AS payable,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid
           FROM contribution_earnings`,
    );
    const c: Record<ContributionState, number> = { pending_review: 0, returned: 0, approved: 0, paid: 0, revoked: 0, };
    for (const r of counts.rows) c[r.state] = Number(r.n,);
    return {
        counts: c,
        owedCents: Number(money.rows[0]?.owed ?? 0,), payableCents: Number(money.rows[0]?.payable ?? 0,), paidCents: Number(money.rows[0]?.paid ?? 0,),
        currency: s.currency,
        contributors: (await contributorRows()).sort((a, b,) => (b.availableCents + b.pendingCents) - (a.availableCents + a.pendingCents),),
    };
}

async function postRow(postId: string,): Promise<{ id: string; title: string; slug: string; status: string; author_id: string | null; submitted_at: Date | null; }> {
    const r = await query<{ id: string; title: string; slug: string; status: string; author_id: string | null; submitted_at: Date | null; }>(
        `SELECT id, title, slug, status, author_id, submitted_at FROM posts WHERE id = $1`, [postId,],
    );
    if (!r.rows[0]) throw new NotFoundError('Post',);
    return r.rows[0];
}

/**
 * Credit (or change) a post's contribution earning: creates it with the
 * holding period, re-credits a revoked one, refuses a paid one.
 */
export async function credit(postId: string, amountCents: number, ctx: AuditContext,): Promise<Contribution> {
    if (!Number.isInteger(amountCents,) || amountCents < 0 || amountCents > 10_000_000) throw new ValidationError('The payout is $0–$100,000.',);
    const post = await postRow(postId,);
    if (!post.author_id) throw new ValidationError('This post has no author to pay.',);
    const s = await getContributorSettings();
    const cur = await query<{ id: string; status: string; payout_id: string | null; }>(`SELECT id, status, payout_id FROM contribution_earnings WHERE post_id = $1`, [postId,],);
    const e = cur.rows[0];
    if (e && (e.status === 'paid' || e.payout_id)) throw new ValidationError('This contribution is already paid (or being paid) — it cannot be changed.',);
    if (e) {
        await query(
            `UPDATE contribution_earnings SET amount_cents = $2, status = 'earned', revoked_by = NULL, revoked_at = NULL, post_title = $3, updated_at = NOW()
              WHERE id = $1`,
            [e.id, amountCents, post.title,],
        );
    } else {
        await query(
            `INSERT INTO contribution_earnings (user_id, post_id, post_title, amount_cents, currency, available_at, created_by)
             VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6), $7)`,
            [post.author_id, postId, post.title, amountCents, s.currency, s.holdDays, uuidOrNull(ctx.userId,),],
        );
    }
    await logAudit({ userId: ctx.userId, action: e ? 'update' : 'create', entityType: 'contribution_earning', entityId: postId, newValues: { amountCents, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(postId,);
}

/** Revoke an unpaid earning (the post stays as it is). */
export async function revoke(postId: string, ctx: AuditContext,): Promise<Contribution> {
    const r = await query(
        `UPDATE contribution_earnings SET status = 'revoked', revoked_by = $2, revoked_at = NOW(), updated_at = NOW()
          WHERE post_id = $1 AND status = 'earned' AND payout_id IS NULL`,
        [postId, uuidOrNull(ctx.userId,),],
    );
    if (!r.rowCount) throw new ValidationError('Only an unpaid contribution can be revoked.',);
    await logAudit({ userId: ctx.userId, action: 'revoke', entityType: 'contribution_earning', entityId: postId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(postId,);
}

/** Take a contributed post off the site (back to draft); its earning is left as is. */
export async function unpublish(postId: string, ctx: AuditContext,): Promise<Contribution> {
    await postRow(postId,);
    await posts.update(postId, { status: 'draft', }, ctx,);
    return get(postId,);
}

export async function get(postId: string,): Promise<Contribution> {
    const r = await query<Row>(`${SELECT} FROM posts p
        LEFT JOIN users u ON u.id = p.author_id
        LEFT JOIN contribution_earnings e ON e.post_id = p.id
        LEFT JOIN affiliate_payouts po ON po.id = e.payout_id
        WHERE p.id = $1`, [postId,],);
    if (!r.rows[0]) throw new NotFoundError('Post',);
    return toContribution(r.rows[0],);
}

/**
 * After a reviewer approved a post (services/postReview): when the program is
 * on and the author is a contributor (not staff), credit the payout (override
 * or default) and send the "content published" emails. Returns whether it was
 * handled as a contribution (the caller then skips the generic review email).
 */
export async function onApproved(postId: string, payoutCents: number | undefined, ctx: AuditContext,): Promise<boolean> {
    const s = await getContributorSettings();
    if (!s.enabled) return false;
    const post = await postRow(postId,);
    if (!post.author_id) return false;
    const author = (await query<{ email: string; display_name: string | null; role: string; }>(`SELECT email, display_name, role FROM users WHERE id = $1`, [post.author_id,],)).rows[0];
    if (!author || isStaffRole(author.role,)) return false;
    const amount = payoutCents ?? s.defaultPayoutCents;
    await credit(postId, amount, ctx,).catch((e: Error,) => logger.warn('contribution credit failed', { postId, error: e.message, },),);
    void sendPublishedEmails(post, author, amount, s.currency,);
    return true;
}

const dollars = (c: number, cur: string,) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase(), },).format(c / 100,);

async function sendPublishedEmails(
    post: { id: string; title: string; slug: string; author_id: string | null; },
    author: { email: string; display_name: string | null; },
    amountCents: number,
    currency: string,
): Promise<void> {
    try {
        const base = await siteBaseUrl();
        const url = `${base}/posts/${post.slug}`;
        const amount = dollars(amountCents, currency,);
        await sendPurposeMail('contribution_published', {
            to: author.email,
            context: {
                user: { name: author.display_name ?? '', email: author.email, },
                post: { title: post.title, url, },
                contribution: { amount, partnerUrl: `${base}/profile?tab=partners&program=contributions`, },
            },
        },);
        await notifyWith('contribution_published', async () => {
            const person = await notifyUser({ userId: post.author_id, },);
            const who = personLabel(person, 'A contributor',);
            const msg = await buildNotification({
                title: 'Contribution published',
                subject: `Contribution published: ${post.title} (${who})`,
                intro: `${who}'s post “${post.title}” was approved and published. ${amount} was credited to their partner balance.`,
                person,
                personHeading: 'Contributor',
                sections: [{ heading: 'Contribution', rows: [{ label: 'Post', value: post.title, }, { label: 'Payout', value: amount, },], },],
                links: [
                    { label: 'Read the post', url, },
                    { label: 'Contributions', url: '/admin/posts?view=contributions', },
                ],
            },);
            return { ...msg, purpose: 'contribution_published_admin', context: { post: { title: post.title, url, }, author: { name: person?.name ?? '', email: person?.email ?? '', }, contribution: { amount, }, }, };
        }, { subject: `Contribution published: ${post.title}`, text: `${post.title} was published (${amount}).\n${url}`, },);
    } catch (e) {
        logger.warn('contribution published emails failed', { postId: post.id, error: (e as Error).message, },);
    }
}

/** Pay contributors (listed, else everyone with a payable balance). */
export async function payOut(userIds: string[] | undefined, actorId: string | null,): Promise<ContributionPayoutsResponse> {
    const ids = userIds?.length ? userIds : await payableUsers('contribution',);
    const names = new Map((await contributorRows(ids,)).map((c,) => [c.userId, c.name || c.email,]),);
    const results: ContributionPayoutsResponse['results'] = [];
    for (const userId of ids) {
        const r = await payOutSource(userId, 'contribution', 'manual', actorId,).catch((e: Error,) => ({ paid: false, amountCents: 0, message: e.message, }),);
        results.push({ ...r, userId, name: names.get(userId,) ?? userId, },);
    }
    return { results, };
}

/** Daily cron: on the configured schedule, pay every contributor with a payable balance. */
export async function runScheduledPayouts(now = new Date(),): Promise<void> {
    const s = await getContributorSettings();
    if (!s.enabled || !isPayoutDue(s.payoutSchedule, s.lastAutoPayoutAt ?? null, now,)) return;
    for (const userId of await payableUsers('contribution',)) {
        const r = await payOutSource(userId, 'contribution', 'auto', null,).catch((e: Error,) => ({ paid: false, message: e.message, }),);
        if (!r.paid) logger.warn('Automatic contributor payout skipped', { userId, reason: r.message, },);
    }
    await markContributorAutoPayoutRun(now,);
}

// ─── The partner's own page (Profile → Partner Program) ───────────────────

export async function isContributor(user: { id: string; role?: string; },): Promise<boolean> {
    const s = await getContributorSettings();
    if (!s.enabled || isStaffRole(user.role,)) return false;
    return can({ id: user.id, role: user.role, }, 'posts:write_own',);
}

async function earningsBalance(table: string, userId: string,): Promise<{ pendingCents: number; availableCents: number; paidCents: number; currency: string; }> {
    const exists = (await query<{ t: string | null; }>(`SELECT to_regclass($1) AS t`, [table,],)).rows[0]?.t;
    if (!exists) return { pendingCents: 0, availableCents: 0, paidCents: 0, currency: 'usd', };
    const r = await query<{ pending: string; available: string; paid: string; currency: string | null; }>(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at > NOW()), 0) AS pending,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'earned' AND payout_id IS NULL AND available_at <= NOW()), 0) AS available,
                COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid, MAX(currency) AS currency
           FROM ${table} WHERE user_id = $1`,
        [userId,],
    );
    const x = r.rows[0];
    return { pendingCents: Number(x?.pending ?? 0,), availableCents: Number(x?.available ?? 0,), paidCents: Number(x?.paid ?? 0,), currency: x?.currency || 'usd', };
}

/** GET /partners/me — which programs the user is in, their Stripe account, totals and their contributions. */
export async function partnerMe(user: { id: string; role?: string; }, isAffiliate: boolean,): Promise<PartnerMeResponse> {
    const contributor = await isContributor(user,);
    if (!isAffiliate && !contributor) throw new ForbiddenError('You are not part of a partner program.',);
    const s = await getContributorSettings();
    const [acct, aff, con,] = await Promise.all([accountRow(user.id,), isAffiliate ? earningsBalance('affiliate_earnings', user.id,) : null, earningsBalance('contribution_earnings', user.id,),],);
    const parts = [aff, contributor || con.paidCents || con.pendingCents || con.availableCents ? con : null,].filter(Boolean,) as Array<typeof con>;
    const totals = {
        pendingCents: parts.reduce((t, p,) => t + p.pendingCents, 0,),
        availableCents: parts.reduce((t, p,) => t + p.availableCents, 0,),
        paidCents: parts.reduce((t, p,) => t + p.paidCents, 0,),
        currency: parts[0]?.currency ?? s.currency,
    };
    let contributions: PartnerMeResponse['contributions'] = null;
    if (contributor) {
        const items = await query<Row>(`${SELECT} ${BASE_FROM} AND p.author_id = $1 ORDER BY COALESCE(p.submitted_at, p.created_at) DESC LIMIT 200`, [user.id,],);
        const { payoutsFor, } = await import('../affiliates/earnings.js');
        contributions = {
            defaultPayoutCents: s.defaultPayoutCents, holdDays: s.holdDays,
            items: items.rows.map(toContribution,), payouts: await payoutsFor(user.id, 100, 'contribution',), balance: con,
        };
    }
    return { programs: { affiliate: isAffiliate, contributor, }, stripe: statusOf(acct,), totals, contributions, };
}
