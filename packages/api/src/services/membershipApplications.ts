/**
 * Membership applications — tiers that REQUIRE APPROVAL (`subscription_plans.
 * requires_approval`, migration 145).
 *
 *   apply   the member answers the tier's application form — its Forms entity
 *           (submitted through the normal Forms pipeline, so the form's own
 *           email / save / add-as-contact settings apply) or the built-in
 *           Name / Email / Phone / Occupation form — and saves a card with a
 *           SetupIntent. NOTHING is charged; the member stays without the tier.
 *   approve an admin starts the membership: `membership.startApprovedMembership`
 *           creates the Stripe subscription and charges the saved card now.
 *           A failed charge keeps the application pending with `error`.
 *   reject  nothing is charged; the member is emailed.
 *
 * `users.approval_status` mirrors the member's latest application so the
 * Users table can filter "pending approval".
 */
import type Stripe from 'stripe';
import type {
    MembershipApplication, MembershipApplicationAnswer, MembershipApplicationsListQuery, MembershipApplicationStatus,
    MembershipApplyBody, MembershipApplyResponse,
} from '@sitesurge/types';
import { DEFAULT_APPLICATION_FIELDS, } from '@sitesurge/types';
import { ConflictError, NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import type { AuditContext, } from './types';
import { sendEmail, } from './email';
import * as forms from './forms';
import { pendingApplicationFor, startApprovedMembership, } from './membership';
import { notify, } from './notifications';
import { getStripeClient, } from './payment/stripe';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const esc = (s: string,) => s.replace(/[&<>"']/g, (c,) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', }[c]!),);

function answerText(v: unknown,): string {
    if (v == null) return '';
    if (Array.isArray(v,)) return v.map(answerText,).join(', ',);
    if (typeof v === 'object') return JSON.stringify(v,);
    return String(v,).trim();
}

interface TierRow { id: string; name: string; is_free: boolean; requires_approval: boolean; application_form_id: string | null; stripe_price_id: string | null; }

async function loadTier(tierId: string,): Promise<TierRow> {
    const r = await query<TierRow>(
        `SELECT id, name, is_free, requires_approval, application_form_id, stripe_price_id FROM subscription_plans WHERE id = $1 AND is_active IS NOT FALSE`,
        [tierId,],
    );
    const t = r.rows[0];
    if (!t) throw new NotFoundError('Membership',);
    if (!t.requires_approval) throw new ValidationError(`${t.name} does not take applications — choose Join.`,);
    if (!t.stripe_price_id) throw new ValidationError(`${t.name} is not available yet.`,);
    return t;
}

async function setUserApproval(userId: string, status: MembershipApplicationStatus | null,): Promise<void> {
    await query(`UPDATE users SET approval_status = $2, updated_at = NOW() WHERE id = $1`, [userId, status === 'withdrawn' ? null : status,],);
}

// ─── Apply ───────────────────────────────────────────────────────────────

export interface ApplyContext { userId: string; email: string; ipAddress: string; userAgent?: string; }

export async function apply(body: MembershipApplyBody, ctx: ApplyContext,): Promise<MembershipApplyResponse> {
    const tier = await loadTier(body.tierId,);
    if (await pendingApplicationFor(ctx.userId,)) throw new ConflictError('You already have an application waiting for review.',);
    const active = await query(
        `SELECT 1 FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND status IN ('active', 'trialing', 'past_due') LIMIT 1`,
        [ctx.userId, tier.id,],
    );
    if (active.rows.length) throw new ValidationError(`You already have ${tier.name}.`,);

    // The saved card (SetupIntent) — verified to belong to this member's customer.
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    let pm: Stripe.PaymentMethod;
    try {
        pm = await stripe.paymentMethods.retrieve(body.paymentMethodId,);
    } catch {
        throw new ValidationError('Your card could not be found — please enter it again.',);
    }
    // The card must sit on THIS member's Stripe customer (the SetupIntent from
    // `membershipCardSetup` attaches it there), never on someone else's.
    const owned = await query<{ customer: string; }>(
        `SELECT stripe_customer_id AS customer FROM users WHERE id = $1 AND stripe_customer_id IS NOT NULL
         UNION SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL`,
        [ctx.userId,],
    );
    const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null;
    if (!pmCustomer || !owned.rows.some((r,) => r.customer === pmCustomer,)) {
        throw new ValidationError('Please enter your card again — it was not saved to your account.',);
    }

    // Answers: the tier's form (normal Forms pipeline) or the built-in form.
    let answers: MembershipApplicationAnswer[];
    let formId: string | null = null;
    let submissionId: string | null = null;
    if (tier.application_form_id) {
        const form = await forms.getById(tier.application_form_id,);
        if (!form || form.status !== 'published') throw new ValidationError('The application form is not available. Please contact us.',);
        const res = await forms.submit({
            slug: form.slug,
            answers: body.answers,
            userId: ctx.userId,
            userEmail: ctx.email,
            hasUser: true,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
        // A duplicate (a member re-applying after a rejection) still records the
        // application — the earlier submission stays in the Forms inbox.
        if ('error' in res && res.error !== 'duplicate') throw new ValidationError('The application could not be submitted.',);
        formId = form.id;
        submissionId = 'ok' in res ? res.submissionId ?? null : null;
        const byId = new Map(body.answers.map((a,) => [a.questionId, a.value,]),);
        answers = form.questions
            .slice()
            .sort((a, b,) => a.order - b.order)
            .map((q,) => ({ label: q.question, value: answerText(byId.get(q.id,),), }));
    } else {
        const byId = new Map(body.answers.map((a,) => [a.questionId, answerText(a.value,),]),);
        answers = DEFAULT_APPLICATION_FIELDS.map((f,) => {
            const value = byId.get(f.id,) ?? '';
            if (f.required && !value) throw new ValidationError(`${f.label} is required.`,);
            if (f.type === 'email' && value && !EMAIL_RE.test(value,)) throw new ValidationError('Enter a valid email address.',);
            if (value.length > 500) throw new ValidationError(`${f.label} is too long.`,);
            return { label: f.label, value, };
        },);
    }

    const ins = await query<{ id: string; created_at: Date; }>(
        `INSERT INTO membership_applications (user_id, plan_id, form_id, submission_id, answers, stripe_customer_id, payment_method_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
        [ctx.userId, tier.id, formId, submissionId, JSON.stringify(answers,), pmCustomer, pm.id,],
    ).catch((e,) => {
        if ((e as { code?: string; }).code === '23505') throw new ConflictError('You already have an application waiting for review.',);
        throw e;
    },);
    await setUserApproval(ctx.userId, 'pending',);

    const rows = answers.map((a,) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${esc(a.label,)}</td><td style="padding:4px 0">${esc(a.value,)}</td></tr>`,).join('',);
    // The tier's own form already emails per its settings; the built-in form uses
    // the "Membership application" notification (Settings → Notifications).
    if (!formId) {
        void notify('membership_application', {
            subject: `Membership application: ${tier.name}`,
            html: `<h2>New membership application</h2><p><strong>${esc(tier.name,)}</strong> — ${esc(ctx.email,)}</p>`
                + `<table>${rows}</table><p><a href="/admin/users?approval=pending">Review in the admin</a></p>`,
        },);
    }
    void sendEmail({
        to: ctx.email,
        subject: `We received your ${tier.name} application`,
        html: `<p>Thank you for applying for <strong>${esc(tier.name,)}</strong>.</p>`
            + `<p>Our team will review your application. Your card is saved but <strong>you will not be charged unless your application is approved</strong>. We will email you when it is reviewed.</p>`,
    },).catch((e: unknown,) => logger.warn('application receipt email failed', { error: (e as Error).message, },),);

    return {
        application: { id: ins.rows[0].id, tierId: tier.id, tierName: tier.name, status: 'pending', createdAt: new Date(ins.rows[0].created_at,).toISOString(), },
    };
}

// ─── Admin ───────────────────────────────────────────────────────────────

const SELECT = `
    SELECT a.*, p.name AS tier_name, f.title AS form_title,
           u.email AS user_email, u.display_name AS user_name, u.handle AS user_handle,
           d.display_name AS decided_by_name
      FROM membership_applications a
      JOIN subscription_plans p ON p.id = a.plan_id
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN forms f ON f.id = a.form_id
      LEFT JOIN users d ON d.id = a.decided_by`;

function mapApp(r: Record<string, unknown>, card: MembershipApplication['card'] = null,): MembershipApplication {
    return {
        id: String(r.id,),
        userId: String(r.user_id,),
        user: r.user_email ? { id: String(r.user_id,), email: String(r.user_email,), displayName: String(r.user_name ?? '',), handle: (r.user_handle as string | null) ?? null, } : null,
        tierId: String(r.plan_id,),
        tierName: String(r.tier_name ?? '',),
        status: r.status as MembershipApplicationStatus,
        formId: (r.form_id as string | null) ?? null,
        formTitle: (r.form_title as string | null) ?? null,
        submissionId: (r.submission_id as string | null) ?? null,
        answers: (r.answers as MembershipApplicationAnswer[] | null) ?? [],
        card,
        note: (r.note as string | null) ?? null,
        error: (r.error as string | null) ?? null,
        decidedBy: (r.decided_by_name as string | null) ?? null,
        decidedAt: r.decided_at ? new Date(r.decided_at as string,).toISOString() : null,
        createdAt: new Date(r.created_at as string,).toISOString(),
    };
}

export async function list(q: MembershipApplicationsListQuery,): Promise<{ data: MembershipApplication[]; total: number; }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) { params.push(q.status,); where.push(`a.status = $${params.length}`,); }
    if (q.userId) { params.push(q.userId,); where.push(`a.user_id = $${params.length}`,); }
    const w = where.length ? `WHERE ${where.join(' AND ',)}` : '';
    const limit = Math.min(Math.max(q.limit ?? 50, 1,), 200,);
    const offset = (Math.max(q.page ?? 1, 1,) - 1) * limit;
    const [rows, count,] = await Promise.all([
        query(`${SELECT} ${w} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params,),
        query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM membership_applications a ${w}`, params,),
    ],);
    return { data: rows.rows.map((r,) => mapApp(r,),), total: count.rows[0]?.n ?? 0, };
}

export async function summary(): Promise<{ pending: number; }> {
    const r = await query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM membership_applications WHERE status = 'pending'`,);
    return { pending: r.rows[0]?.n ?? 0, };
}

async function cardOf(pmId: string | null,): Promise<MembershipApplication['card']> {
    const stripe = getStripeClient('default',);
    if (!stripe || !pmId) return null;
    try {
        const pm = await stripe.paymentMethods.retrieve(pmId,);
        return pm.card ? { brand: pm.card.brand, last4: pm.card.last4, } : null;
    } catch {
        return null;
    }
}

export async function get(id: string,): Promise<MembershipApplication> {
    const r = await query(`${SELECT} WHERE a.id = $1`, [id,],);
    const row = r.rows[0];
    if (!row) throw new NotFoundError('Application',);
    return mapApp(row, await cardOf((row.payment_method_id as string | null) ?? null,),);
}

async function loadPending(id: string,) {
    const r = await query<{ id: string; user_id: string; plan_id: string; status: string; payment_method_id: string | null; }>(
        `SELECT id, user_id, plan_id, status, payment_method_id FROM membership_applications WHERE id = $1`, [id,],
    );
    const a = r.rows[0];
    if (!a) throw new NotFoundError('Application',);
    if (a.status !== 'pending') throw new ValidationError(`This application was already ${a.status}.`,);
    return a;
}

/** Approve: start the membership and charge the saved card now. */
export async function approve(id: string, note: string | undefined, ctx: AuditContext,): Promise<MembershipApplication> {
    const a = await loadPending(id,);
    try {
        await startApprovedMembership(a.user_id, a.plan_id, a.payment_method_id,);
    } catch (e) {
        const message = (e as Error).message;
        await query(`UPDATE membership_applications SET error = $2, updated_at = NOW() WHERE id = $1`, [id, message,],);
        throw e instanceof ValidationError ? e : new ValidationError(message,);
    }
    await query(
        `UPDATE membership_applications SET status = 'approved', note = $2, error = NULL, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id, note?.trim() || null, ctx.userId || null,],
    );
    await setUserApproval(a.user_id, 'approved',);
    await logAudit({ userId: ctx.userId, action: 'approve', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(id,);
}

/** Reject: nothing is charged; the member is told. */
export async function reject(id: string, note: string | undefined, ctx: AuditContext,): Promise<MembershipApplication> {
    const a = await loadPending(id,);
    await query(
        `UPDATE membership_applications SET status = 'rejected', note = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id, note?.trim() || null, ctx.userId || null,],
    );
    await setUserApproval(a.user_id, 'rejected',);
    await logAudit({ userId: ctx.userId, action: 'reject', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    const app = await get(id,);
    if (app.user) {
        void sendEmail({
            to: app.user.email,
            subject: `Your ${app.tierName} application`,
            html: `<p>Thank you for applying for <strong>${esc(app.tierName,)}</strong>. We are not able to approve your application at this time.</p>`
                + (note?.trim() ? `<p>${esc(note.trim(),)}</p>` : '')
                + `<p>Your card was not charged.</p>`,
        },).catch(() => {},);
    }
    return app;
}

/** The member withdraws their own pending application. */
export async function withdraw(userId: string,): Promise<void> {
    const r = await query<{ id: string; }>(
        `UPDATE membership_applications SET status = 'withdrawn', updated_at = NOW() WHERE user_id = $1 AND status = 'pending' RETURNING id`, [userId,],
    );
    if (r.rows.length) await setUserApproval(userId, null,);
}
