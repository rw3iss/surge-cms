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
import { createHmac, randomUUID, timingSafeEqual, } from 'crypto';
import type Stripe from 'stripe';
import type {
    MembershipApplication, MembershipApplicationAnswer, MembershipApplicationsListQuery, MembershipApplicationStatus,
    MembershipApplyBody, MembershipApplyCardBody, MembershipApplyResponse, MembershipApplySubmitBody, MembershipApplySubmitResponse,
    MembershipProgramStatus,
} from '@sitesurge/types';
import { DEFAULT_APPLICATION_FIELDS, } from '@sitesurge/types';
import { config, } from '../config';
import { ConflictError, NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import type { AuditContext, } from './types';
import { sendPurposeMail, } from './mail/purposes';
import * as forms from './forms';
import { assertTierPrice, pendingApplicationFor, startApprovedMembership, } from './membership';
import { buildNotification, notifyUser, notifyWith, personLabel, } from './notifications';
import { priceLabel, } from './payment/subscriptionNotice';
import { getStripeClient, } from './payment/stripe';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;


function answerText(v: unknown,): string {
    if (v == null) return '';
    if (Array.isArray(v,)) return v.map(answerText,).join(', ',);
    if (typeof v === 'object') return JSON.stringify(v,);
    return String(v,).trim();
}

interface TierRow { id: string; name: string; is_free: boolean; requires_approval: boolean; application_form_id: string | null; stripe_price_id: string | null; hide_price: boolean; role_only: boolean; role: string | null; }

async function loadTier(tierId: string,): Promise<TierRow> {
    const r = await query<TierRow>(
        `SELECT id, name, is_free, requires_approval, application_form_id, stripe_price_id, COALESCE(hide_price, false) AS hide_price, role_only, role FROM subscription_plans WHERE id = $1 AND is_active IS NOT FALSE`,
        [tierId,],
    );
    const t = r.rows[0];
    if (!t) throw new NotFoundError('Membership',);
    if (!t.requires_approval) throw new ValidationError(`${t.name} does not take applications — choose Join.`,);
    // A "Hide price" level takes no card when applying, so it may have no price yet.
    if (!t.stripe_price_id && !t.hide_price) throw new ValidationError(`${t.name} is not available yet.`,);
    return t;
}

/**
 * Mirror onto `users.approval_status` (the Users "Approval" filter). A member
 * may have several applications at once (one per program + one membership), so
 * it stays `pending` while ANY of them is still waiting; otherwise the latest outcome.
 */
async function setUserApproval(userId: string, status: MembershipApplicationStatus | null,): Promise<void> {
    await query(
        `UPDATE users SET updated_at = NOW(), approval_status = CASE
            WHEN EXISTS (SELECT 1 FROM membership_applications WHERE user_id = $1 AND status = 'pending') THEN 'pending'
            ELSE $2 END
          WHERE id = $1`,
        [userId, status === 'withdrawn' ? null : status,],
    );
}

// ─── Apply ───────────────────────────────────────────────────────────────
//
// Two steps, so a visitor's request reaches the team AT ONCE (they get a call)
// even before they have an account:
//   submit  the answers (anonymous allowed) → form pipeline / notification,
//           a pending row, and a signed `token` for an account-less row;
//   card    signed in: claim the row (token) and save the card (no charge).
// `apply` does both in one call (signed in) for API/SDK callers.

export interface ApplyContext { userId: string | null; email: string | null; ipAddress: string; userAgent?: string; }

const TOKEN_TTL_SEC = 7 * 86400;

/** Signed handle for an account-less application: `<id>.<exp>.<sig>`. */
function applicationToken(id: string, now = Date.now(),): string {
    const exp = Math.floor(now / 1000,) + TOKEN_TTL_SEC;
    const sig = createHmac('sha256', config.jwt.secret ?? '',).update(`membership-application:${id}:${exp}`,).digest('base64url',);
    return `${id}.${exp}.${sig}`;
}

function verifyApplicationToken(token: string, now = Date.now(),): string | null {
    const [id, exp, sig,] = token.split('.',);
    if (!id || !exp || !sig || Number(exp,) * 1000 < now) return null;
    const want = createHmac('sha256', config.jwt.secret ?? '',).update(`membership-application:${id}:${exp}`,).digest('base64url',);
    const a = Buffer.from(sig,);
    const b = Buffer.from(want,);
    return a.length === b.length && timingSafeEqual(a, b,) ? id : null;
}

/** Validate + label the answers; a Forms-entity application is submitted through the Forms pipeline. */
async function collectAnswers(tier: TierRow, raw: MembershipApplyBody['answers'], ctx: ApplyContext,) {
    let answers: MembershipApplicationAnswer[];
    let formId: string | null = null;
    let submissionId: string | null = null;
    let email: string | null = null;
    if (tier.application_form_id) {
        const form = await forms.getById(tier.application_form_id,);
        if (!form || form.status !== 'published') throw new ValidationError('The application form is not available. Please contact us.',);
        const res = await forms.submit({
            slug: form.slug,
            answers: raw,
            userId: ctx.userId,
            userEmail: ctx.email ?? undefined,
            hasUser: !!ctx.userId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
        // A duplicate (re-applying after a rejection) still records the
        // application — the earlier submission stays in the Forms inbox.
        if ('error' in res && res.error !== 'duplicate') throw new ValidationError('The application could not be submitted.',);
        formId = form.id;
        submissionId = 'ok' in res ? res.submissionId ?? null : null;
        const byId = new Map(raw.map((a,) => [a.questionId, a.value,]),);
        const sorted = form.questions.slice().sort((a, b,) => a.order - b.order);
        answers = sorted.map((q,) => ({ label: q.question, value: answerText(byId.get(q.id,),), }));
        const emailQ = sorted.find((q,) => q.type === 'email',);
        email = emailQ ? answerText(byId.get(emailQ.id,),) || null : null;
    } else {
        const byId = new Map(raw.map((a,) => [a.questionId, answerText(a.value,),]),);
        answers = DEFAULT_APPLICATION_FIELDS.map((f,) => {
            const value = byId.get(f.id,) ?? '';
            if (f.required && !value) throw new ValidationError(`${f.label} is required.`,);
            if (f.type === 'email' && value && !EMAIL_RE.test(value,)) throw new ValidationError('Enter a valid email address.',);
            if (value.length > 500) throw new ValidationError(`${f.label} is too long.`,);
            return { label: f.label, value, };
        },);
        email = byId.get('email',) || null;
    }
    return { answers, formId, submissionId, email: ctx.email || (email && EMAIL_RE.test(email,) ? email : null), };
}

/** The card must sit on THIS member's Stripe customer (the `membershipCardSetup` SetupIntent puts it there). */
async function verifyCard(userId: string, paymentMethodId: string,): Promise<{ pmId: string; customer: string; }> {
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    let pm: Stripe.PaymentMethod;
    try {
        pm = await stripe.paymentMethods.retrieve(paymentMethodId,);
    } catch {
        throw new ValidationError('Your card could not be found — please enter it again.',);
    }
    const owned = await query<{ customer: string; }>(
        `SELECT stripe_customer_id AS customer FROM users WHERE id = $1 AND stripe_customer_id IS NOT NULL
         UNION SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL`,
        [userId,],
    );
    const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null;
    if (!pmCustomer || !owned.rows.some((r,) => r.customer === pmCustomer,)) {
        throw new ValidationError('Please enter your card again — it was not saved to your account.',);
    }
    return { pmId: pm.id, customer: pmCustomer, };
}

async function assertCanApply(userId: string, tier: TierRow,): Promise<void> {
    if (tier.role_only) {
        // A program: one pending application per program, and not when the role is already held.
        const dup = await query(`SELECT 1 FROM membership_applications WHERE user_id = $1 AND plan_id = $2 AND status = 'pending' LIMIT 1`, [userId, tier.id,],);
        if (dup.rows.length) throw new ConflictError('You already have an application for this program waiting for review.',);
        const u = await query<{ role: string; extra_roles: string[] | null; }>(`SELECT role, extra_roles FROM users WHERE id = $1`, [userId,],);
        const held = u.rows[0] ? [u.rows[0].role, ...(u.rows[0].extra_roles ?? []),] : [];
        if (tier.role && held.includes(tier.role,)) throw new ValidationError(`You are already part of ${tier.name}.`,);
        return;
    }
    if (await pendingApplicationFor(userId,)) throw new ConflictError('You already have an application waiting for review.',);
    const active = await query(
        `SELECT 1 FROM subscriptions WHERE user_id = $1 AND plan_id = $2 AND status IN ('active', 'trialing', 'past_due') LIMIT 1`,
        [userId, tier.id,],
    );
    if (active.rows.length) throw new ValidationError(`You already have ${tier.name}.`,);
}

/** The team's "new application" notification. */
async function applicationNotice(
    applicationId: string,
    tier: TierRow,
    priceId: string | null,
    answers: MembershipApplicationAnswer[],
    userId: string | null,
    email: string | null,
) {
    const name = answers.find((a,) => /^(full )?name$/i.test(a.label.trim(),),)?.value || null;
    const person = await notifyUser({ userId, email, name, },);
    let price = '';
    const pid = priceId || tier.stripe_price_id;
    const stripe = pid ? getStripeClient() : null;
    if (stripe && pid) price = priceLabel(await stripe.prices.retrieve(pid,).catch(() => null) as never,);
    const who = personLabel(person, email || 'Someone',);
    return buildNotification({
        title: 'New membership application',
        subject: `Membership application — ${who} (${tier.name})`,
        intro: `${who} applied for ${tier.name}. Nothing is charged until the application is approved.`,
        person,
        personHeading: 'Applicant',
        sections: [
            { heading: 'Application', rows: [{ label: 'Level', value: tier.name, }, { label: 'Chosen price', value: price, },], },
            { heading: 'Answers', rows: answers.map((a,) => ({ label: a.label, value: a.value || '—', })), },
        ],
        links: [
            { label: 'Review application', url: `/admin/users?application=${applicationId}`, },
            { label: 'All pending applications', url: '/admin/users?approval=pending', },
            ...(person?.adminUrl ? [{ label: 'View member', url: person.adminUrl, },] : []),
        ],
    },);
}

/** Site base URL for links in emails. */
function siteUrl(path: string,): string {
    return `${((config.frontendUrl as string | undefined) ?? '').replace(/\/+$/, '',)}${path}`;
}

/**
 * Where an applicant finishes: Profile → Membership, carrying the claim token
 * for an application submitted signed out. The profile sends a signed-out
 * visitor through log in / sign up and claims it after (the token is the
 * credential, so another device or a closed tab no longer loses it).
 */
export function claimUrl(applicationId: string, tierId: string, token: string | null,): string {
    const q = new URLSearchParams({ tab: 'membership', tier: tierId, },);
    if (token) { q.set('claim', applicationId,); q.set('token', token,); }
    return siteUrl(`/profile?${q.toString()}`,);
}

/** What the applicant still has to do, for the "we received it" email (plain text). */
export function receiptNext(o: { signedIn: boolean; noCard: boolean; },): string {
    return o.noCard
        ? (o.signedIn
            ? 'There is nothing else to do now. We will email you when your application has been reviewed.'
            : 'Create your account with this email address so we can attach your application. Nothing is charged.')
        : (o.signedIn
            ? 'If you have not added your card yet, add it now. You will not be charged unless your application is approved.'
            : 'Create your account with this email address and add your card. You will not be charged unless your application is approved.');
}

/**
 * Team follow-up on an application's lifecycle ("card added — ready to
 * approve", "withdrawn"), on the same `membership_application` notification
 * as the first notice, with the same deep link — so reviewers need not poll.
 */
function applicationFollowUp(applicationId: string | null, userId: string, tierName: string, kind: 'card' | 'withdrawn' | 'left',): void {
    const title = kind === 'card' ? 'Membership application ready to approve'
        : kind === 'left' ? `Member left ${tierName}`
        : 'Membership application withdrawn';
    void notifyWith('membership_application', async () => {
        const person = await notifyUser({ userId, },);
        const who = personLabel(person, 'An applicant',);
        return buildNotification({
            title,
            subject: `${title} — ${who} (${tierName})`,
            intro: kind === 'card'
                ? `${who} added their card for ${tierName}. The application can now be approved.`
                : kind === 'left'
                ? `${who} left ${tierName}. Its role was removed from their account.`
                : `${who} withdrew (cancelled) their application for ${tierName}.`,
            person,
            personHeading: 'Applicant',
            sections: [{ heading: 'Application', rows: [{ label: 'Level', value: tierName, },], },],
            links: kind === 'card'
                ? [
                    { label: 'Review application', url: `/admin/users?application=${applicationId}`, },
                    { label: 'All pending applications', url: '/admin/users?approval=pending', },
                    ...(person?.adminUrl ? [{ label: 'View member', url: person.adminUrl, },] : []),
                ]
                : [
                    ...(person?.adminUrl ? [{ label: 'View member', url: person.adminUrl, },] : []),
                    { label: 'All pending applications', url: '/admin/users?approval=pending', },
                ],
        },);
    }, { subject: `${title}: ${tierName}`, text: `${title}: ${tierName}.`, },);
}

/** Step 1 — the answers (signed in or not). Emails the team at once. */
export async function submit(body: MembershipApplySubmitBody, ctx: ApplyContext,): Promise<MembershipApplySubmitResponse> {
    const tier = await loadTier(body.tierId,);
    // Honeypot: a bot filled the hidden field. Answer as if accepted; store and send nothing.
    if (body.website) {
        return {
            application: { id: randomUUID(), tierId: tier.id, tierName: tier.name, status: 'pending', createdAt: new Date().toISOString(), },
            token: null,
        };
    }
    if (ctx.userId) await assertCanApply(ctx.userId, tier,);
    await assertTierPrice(tier.id, body.priceId,);
    const c = await collectAnswers(tier, body.answers, ctx,);
    // A signed-out applicant who sends the same level again (a retry, or a
    // script) gets the SAME application back — no second row, no second
    // round of emails. At most one pending account-less row per (email, level).
    if (!ctx.userId && c.email) {
        const dup = await query<{ id: string; created_at: Date; }>(
            `SELECT id, created_at FROM membership_applications
              WHERE user_id IS NULL AND status = 'pending' AND plan_id = $1 AND lower(contact_email) = lower($2)
              ORDER BY created_at DESC LIMIT 1`,
            [tier.id, c.email,],
        );
        if (dup.rows[0]) {
            return {
                application: { id: dup.rows[0].id, tierId: tier.id, tierName: tier.name, status: 'pending', createdAt: new Date(dup.rows[0].created_at,).toISOString(), },
                token: applicationToken(dup.rows[0].id,),
            };
        }
    }
    const ins = await query<{ id: string; created_at: Date; }>(
        `INSERT INTO membership_applications (user_id, plan_id, form_id, submission_id, answers, contact_email, price_id, program)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
        [ctx.userId, tier.id, c.formId, c.submissionId, JSON.stringify(c.answers,), c.email, body.priceId ?? null, tier.role_only,],
    ).catch((e,) => {
        if ((e as { code?: string; }).code === '23505') {
            throw new ConflictError(tier.role_only
                ? 'You already have an application for this program waiting for review.'
                : 'You already have an application waiting for review.',);
        }
        throw e;
    },);
    const id = ins.rows[0].id;
    if (ctx.userId) await setUserApproval(ctx.userId, 'pending',);
    const token = ctx.userId ? null : applicationToken(id,);

    // The tier's own form already emails per its settings; the built-in form uses
    // the "Membership application" notification (Settings → Notifications).
    if (!c.formId) {
        void notifyWith('membership_application', () => applicationNotice(id, tier, body.priceId ?? null, c.answers, ctx.userId, c.email,), {
            subject: `Membership application: ${tier.name}`,
            text: `New membership application for ${tier.name}${c.email ? ` — ${c.email}` : ''}.`,
        },);
    }
    if (c.email) {
        const hide = (await query<{ hide_price: boolean; }>(`SELECT hide_price FROM subscription_plans WHERE id = $1`, [tier.id,],)).rows[0]?.hide_price === true;
        // Operator-editable: Users → Settings → Email templates → "Membership application received".
        void sendPurposeMail('membership_application_received', {
            to: c.email,
            context: {
                user: { name: c.answers.find((x,) => /^(full )?name$/i.test(x.label.trim(),),)?.value ?? '', email: c.email, },
                tier: { name: tier.name, },
                application: {
                    next: receiptNext({ signedIn: !!ctx.userId, noCard: hide || tier.role_only, },),
                    // "Finish my application" only when something is left to do:
                    // signed out (create the account), or a card still to add.
                    claimUrl: !ctx.userId || !(hide || tier.role_only) ? claimUrl(id, tier.id, token,) : '',
                    // Signed in with nothing to do: where the member follows it.
                    viewUrl: ctx.userId ? siteUrl('/profile?tab=membership',) : '',
                    program: tier.role_only ? 'yes' : '',
                },
            },
        },).catch((e: unknown,) => logger.warn('application receipt email failed', { error: (e as Error).message, },),);
    }
    return {
        application: { id, tierId: tier.id, tierName: tier.name, status: 'pending', createdAt: new Date(ins.rows[0].created_at,).toISOString(), },
        // Only an account-less application needs a handle to claim it later.
        token,
    };
}

/**
 * Attach account-less applications to a user whose email is now PROVEN
 * (verified by the verification link, or by an invite link). Only then: with
 * an unverified address anyone could sign up as the applicant and take over
 * their application. One pending row at most (one pending per user), plus
 * any approved, unstarted offers.
 */
export async function claimByVerifiedEmail(userId: string, email: string,): Promise<number> {
    let n = 0;
    try {
        const rows = await query<{ id: string; status: string; role_only: boolean; }>(
            `SELECT a.id, a.status, p.role_only FROM membership_applications a JOIN subscription_plans p ON p.id = a.plan_id
              WHERE a.user_id IS NULL AND lower(a.contact_email) = lower($1) AND a.status IN ('pending', 'approved')
              ORDER BY a.created_at DESC`,
            [email,],
        );
        let pendingTaken = !!(await pendingApplicationFor(userId,));
        for (const r of rows.rows) {
            // Programs don't count against the one pending MEMBERSHIP application.
            if (r.status === 'pending' && !r.role_only) {
                if (pendingTaken) continue;
                pendingTaken = true;
            }
            const u = await query(`UPDATE membership_applications SET user_id = $2, updated_at = NOW() WHERE id = $1 AND user_id IS NULL`, [r.id, userId,],);
            if (u.rowCount) {
                n++;
                if (r.role_only) await activateProgram(r.id, userId,);
                else await setUserApproval(userId, r.status as MembershipApplicationStatus,);
            }
        }
    } catch (e) {
        logger.warn('membership: could not attach applications by email', { userId, error: (e as Error).message, },);
    }
    return n;
}

/** Step 2 — signed in: claim the application (token, when submitted signed out) and save the card. */
export async function attachCard(userId: string, body: MembershipApplyCardBody,): Promise<MembershipApplyResponse> {
    const r = await query<{ id: string; user_id: string | null; plan_id: string; status: string; created_at: Date; name: string; }>(
        `SELECT a.id, a.user_id, a.plan_id, a.status, a.created_at, p.name FROM membership_applications a
           JOIN subscription_plans p ON p.id = a.plan_id WHERE a.id = $1`,
        [body.applicationId,],
    );
    const a = r.rows[0];
    if (!a || a.status !== 'pending') throw new NotFoundError('Application',);
    if (a.user_id && a.user_id !== userId) throw new NotFoundError('Application',);
    if (!a.user_id) {
        if (!body.token || verifyApplicationToken(body.token,) !== a.id) throw new NotFoundError('Application',);
        await assertCanApply(userId, (await query<TierRow>(`SELECT id, name, is_free, requires_approval, application_form_id, stripe_price_id FROM subscription_plans WHERE id = $1`, [a.plan_id,],)).rows[0]!,);
    }
    const card = await verifyCard(userId, body.paymentMethodId,);
    await query(
        `UPDATE membership_applications SET user_id = $2, stripe_customer_id = $3, payment_method_id = $4, updated_at = NOW() WHERE id = $1`,
        [a.id, userId, card.customer, card.pmId,],
    );
    await setUserApproval(userId, 'pending',);
    applicationFollowUp(a.id, userId, a.name, 'card',);
    return { application: { id: a.id, tierId: a.plan_id, tierName: a.name, status: 'pending', createdAt: new Date(a.created_at,).toISOString(), }, };
}

/**
 * Signed in: claim an application submitted before the account existed,
 * WITHOUT a card — for "hide price" levels, where no card is taken at apply time.
 */
export async function claim(userId: string, body: { applicationId: string; token?: string | null; },): Promise<MembershipApplyResponse> {
    const r = await query<{ id: string; user_id: string | null; plan_id: string; status: string; created_at: Date; name: string; hide_price: boolean; }>(
        `SELECT a.id, a.user_id, a.plan_id, a.status, a.created_at, p.name, p.hide_price FROM membership_applications a
           JOIN subscription_plans p ON p.id = a.plan_id WHERE a.id = $1`,
        [body.applicationId,],
    );
    const a = r.rows[0];
    if (!a || !['pending', 'approved',].includes(a.status,)) throw new NotFoundError('Application',);
    if (a.user_id && a.user_id !== userId) throw new NotFoundError('Application',);
    if (!a.user_id) {
        if (!body.token || verifyApplicationToken(body.token,) !== a.id) throw new NotFoundError('Application',);
        await query(`UPDATE membership_applications SET user_id = $2, updated_at = NOW() WHERE id = $1`, [a.id, userId,],);
    }
    if (await isProgramApplication(a.id,)) await activateProgram(a.id, userId,);
    else await setUserApproval(userId, a.status === 'approved' ? 'approved' : 'pending',);
    return { application: { id: a.id, tierId: a.plan_id, tierName: a.name, status: a.status as MembershipApplicationStatus, createdAt: new Date(a.created_at,).toISOString(), }, };
}

/** Both steps in one call (signed in). */
export async function apply(body: MembershipApplyBody, ctx: ApplyContext & { userId: string; },): Promise<MembershipApplyResponse> {
    const tier = await loadTier(body.tierId,);
    await assertCanApply(ctx.userId, tier,);
    await verifyCard(ctx.userId, body.paymentMethodId,);
    const s = await submit({ tierId: body.tierId, priceId: body.priceId, answers: body.answers, }, ctx,);
    return attachCard(ctx.userId, { applicationId: s.application.id, paymentMethodId: body.paymentMethodId, },);
}

// ─── Programs ("Add its role only") ─────────────────────────────────────
//
// Approving a program application adds the level's role to the member's
// ADDITIONAL roles; their membership and billing are untouched. Without a
// linked account: a VERIFIED account using the application's email is linked
// at once; with no account at all an invite is sent (it carries the role, so
// the role is there when they sign up); an unverified account waits until the
// address is verified (claimByVerifiedEmail grants it then).

async function isProgramApplication(applicationId: string,): Promise<boolean> {
    const r = await query<{ role_only: boolean; }>(
        `SELECT p.role_only FROM membership_applications a JOIN subscription_plans p ON p.id = a.plan_id WHERE a.id = $1`, [applicationId,],
    );
    return r.rows[0]?.role_only === true;
}

/** An APPROVED program application on this account: add the role, mark it started. Idempotent. */
async function activateProgram(applicationId: string, userId: string,): Promise<void> {
    const r = await query<{ status: string; activated_at: Date | null; role: string | null; }>(
        `SELECT a.status, a.activated_at, p.role FROM membership_applications a JOIN subscription_plans p ON p.id = a.plan_id WHERE a.id = $1`,
        [applicationId,],
    );
    const a = r.rows[0];
    if (!a || a.status !== 'approved' || a.activated_at || !a.role) return;
    const { addExtraRoles, } = await import('./users.js');
    await addExtraRoles(userId, [a.role,],);
    await query(`UPDATE membership_applications SET activated_at = NOW(), updated_at = NOW() WHERE id = $1`, [applicationId,],);
}

/** The account that already uses an application's email (account-less applications). */
async function accountForEmail(email: string | null,): Promise<{ id: string; email: string; displayName: string; emailVerified: boolean; } | null> {
    if (!email) return null;
    const r = await query<{ id: string; email: string; display_name: string | null; email_verified: boolean; }>(
        `SELECT id, email, display_name, email_verified FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email,],
    );
    const u = r.rows[0];
    return u ? { id: u.id, email: u.email, displayName: u.display_name ?? '', emailVerified: u.email_verified === true, } : null;
}

async function approveProgram(
    a: Awaited<ReturnType<typeof loadPending>>, id: string, tier: { name: string; role: string | null; }, note: string | undefined, ctx: AuditContext,
): Promise<MembershipApplication> {
    if (!tier.role) throw new ValidationError(`${tier.name} has no role to add — set its Role first.`,);
    let userId = a.user_id;
    const app0 = await get(id,);
    let invited = false;
    if (!userId) {
        const acct = await accountForEmail(app0.contactEmail,);
        if (acct?.emailVerified) {
            await query(`UPDATE membership_applications SET user_id = $2, updated_at = NOW() WHERE id = $1 AND user_id IS NULL`, [id, acct.id,],);
            userId = acct.id;
        } else if (acct) {
            throw new ValidationError(`${app0.contactEmail} belongs to an account that has not verified its email yet. Link it below once you are sure it is theirs, or ask them to verify their email first.`,);
        } else if (app0.contactEmail) {
            // No account: an invite that carries the role (added when they sign up).
            const { invite, } = await import('./userInvites.js');
            const name = app0.answers.find((x,) => /^(full )?name$/i.test(x.label.trim(),),)?.value || undefined;
            await invite({ email: app0.contactEmail, name, roles: [tier.role,], }, ctx,);
            invited = true;
        } else {
            throw new ValidationError('This application has no email address to invite.',);
        }
    }
    await query(
        `UPDATE membership_applications SET status = 'approved', note = $2, error = NULL, decided_by = $3, decided_at = NOW(), updated_at = NOW(), offer_expires_at = NULL WHERE id = $1`,
        [id, note?.trim() || null, ctx.userId || null,],
    );
    if (userId) await activateProgram(id, userId,);
    await logAudit({ userId: ctx.userId, action: 'approve', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, program: true, role: tier.role, invited, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    const app = await get(id,);
    if (app.contactEmail) {
        void sendPurposeMail('membership_application_approved', {
            to: app.contactEmail,
            context: {
                user: { name: app.user?.displayName ?? '', email: app.contactEmail, },
                tier: { name: tier.name, },
                application: { program: 'yes', invited: invited ? 'yes' : '', },
                note: note?.trim() ?? '',
            },
        },).catch(() => {},);
    }
    return app;
}

/**
 * Admin: link an account-less application to the account that uses its email
 * (the review panel's "Link to this account"). Only that account — the email
 * must match, so a slip cannot attach someone else's application. An approved
 * program's role is added at once.
 */
export async function linkToAccount(id: string, userId: string, ctx: AuditContext,): Promise<MembershipApplication> {
    const app = await get(id,);
    if (app.userId) throw new ConflictError('This application is already linked to an account.',);
    if (!['pending', 'approved',].includes(app.status,)) throw new ValidationError('Only a pending or approved application can be linked.',);
    const acct = await accountForEmail(app.contactEmail,);
    if (!acct || acct.id !== userId) throw new ValidationError('That account does not use this application\'s email address.',);
    await query(`UPDATE membership_applications SET user_id = $2, updated_at = NOW() WHERE id = $1 AND user_id IS NULL`, [id, userId,],);
    if (await isProgramApplication(id,)) await activateProgram(id, userId,);
    else await setUserApproval(userId, app.status === 'approved' ? 'approved' : 'pending',);
    await logAudit({ userId: ctx.userId, action: 'link_account', entityType: 'membership_application', entityId: id, newValues: { userId, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(id,);
}

// ─── Admin ───────────────────────────────────────────────────────────────

const SELECT = `
    SELECT a.*, p.name AS tier_name, p.hide_price AS tier_hide_price, p.stripe_price_id AS tier_price_id, p.role_only AS tier_role_only, p.role AS tier_role, f.title AS form_title,
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
        userId: (r.user_id as string | null) ?? null,
        contactEmail: (r.contact_email as string | null) ?? (r.user_email as string | null) ?? null,
        user: r.user_email ? { id: String(r.user_id,), email: String(r.user_email,), displayName: String(r.user_name ?? '',), handle: (r.user_handle as string | null) ?? null, } : null,
        tierId: String(r.plan_id,),
        tierName: String(r.tier_name ?? '',),
        tierHidePrice: r.tier_hide_price === true,
        tierRoleOnly: r.tier_role_only === true,
        tierRole: (r.tier_role as string | null) ?? null,
        activatedAt: r.activated_at ? new Date(r.activated_at as string,).toISOString() : null,
        status: r.status as MembershipApplicationStatus,
        formId: (r.form_id as string | null) ?? null,
        formTitle: (r.form_title as string | null) ?? null,
        submissionId: (r.submission_id as string | null) ?? null,
        answers: (r.answers as MembershipApplicationAnswer[] | null) ?? [],
        card,
        offerExpiresAt: r.offer_expires_at ? new Date(r.offer_expires_at as string,).toISOString() : null,
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
    if (q.withoutAccount) where.push('a.user_id IS NULL',);
    const w = where.length ? `WHERE ${where.join(' AND ',)}` : '';
    const limit = Math.min(Math.max(q.limit ?? 50, 1,), 200,);
    const offset = (Math.max(q.page ?? 1, 1,) - 1) * limit;
    const [rows, count,] = await Promise.all([
        query(`${SELECT} ${w} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`, params,),
        query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM membership_applications a ${w}`, params,),
    ],);
    return { data: rows.rows.map((r,) => mapApp(r,),), total: count.rows[0]?.n ?? 0, };
}

export async function summary(): Promise<{ pending: number; withoutAccount: number; }> {
    const r = await query<{ n: number; anon: number; }>(
        `SELECT COUNT(*)::int AS n, (COUNT(*) FILTER (WHERE user_id IS NULL))::int AS anon FROM membership_applications WHERE status = 'pending'`,
    );
    return { pending: r.rows[0]?.n ?? 0, withoutAccount: r.rows[0]?.anon ?? 0, };
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

/** The Stripe price approval will bill (the chosen one, else the level's default). */
async function priceOf(priceId: string | null,): Promise<MembershipApplication['price']> {
    const stripe = getStripeClient('default',);
    if (!stripe || !priceId) return null;
    try {
        const p = await stripe.prices.retrieve(priceId,);
        return { priceId: p.id, amount: p.unit_amount ?? 0, currency: p.currency, interval: p.recurring?.interval ?? 'month', intervalCount: p.recurring?.interval_count ?? 1, };
    } catch {
        return null;
    }
}

export async function get(id: string,): Promise<MembershipApplication> {
    const r = await query(`${SELECT} WHERE a.id = $1`, [id,],);
    const row = r.rows[0];
    if (!row) throw new NotFoundError('Application',);
    const [card, price,] = await Promise.all([
        cardOf((row.payment_method_id as string | null) ?? null,),
        priceOf((row.price_id as string | null) ?? (row.tier_price_id as string | null) ?? null,),
    ],);
    const app = mapApp(row, card,);
    // Account-less: the account that already uses its email, for "Link to this account".
    const matchedAccount = app.userId ? null : await accountForEmail(app.contactEmail,);
    return { ...app, price, matchedAccount, };
}

async function loadPending(id: string,) {
    const r = await query<{ id: string; user_id: string | null; plan_id: string; status: string; payment_method_id: string | null; price_id: string | null; }>(
        `SELECT id, user_id, plan_id, status, payment_method_id, price_id FROM membership_applications WHERE id = $1`, [id,],
    );
    const a = r.rows[0];
    if (!a) throw new NotFoundError('Application',);
    if (a.status !== 'pending') throw new ValidationError(`This application was already ${a.status}.`,);
    return a;
}

/** How long a "hide price" approval (an offer) stays open. */
export const OFFER_TTL_DAYS = 30;

/**
 * Claim a pending application for approval: one conditional UPDATE, so only
 * ONE approval at a time gets past here (two admins / two tabs / a retried
 * request would otherwise both charge the card). Returns the claim time, or
 * throws when someone else is approving it right now.
 */
async function claimForApproval(id: string,): Promise<Date> {
    const r = await query<{ approving_at: Date; }>(
        `UPDATE membership_applications SET approving_at = NOW()
          WHERE id = $1 AND status = 'pending' AND (approving_at IS NULL OR approving_at < NOW() - INTERVAL '5 minutes')
          RETURNING approving_at`,
        [id,],
    );
    if (!r.rows[0]) throw new ConflictError('This application is being approved by someone else right now.',);
    return new Date(r.rows[0].approving_at,);
}

async function releaseClaim(id: string,): Promise<void> {
    await query(`UPDATE membership_applications SET approving_at = NULL WHERE id = $1`, [id,],).catch(() => {},);
}

/**
 * Approve. Normally: start the membership and charge the saved card now.
 * A "hide price" level (no card was taken): approval is an OFFER — the member
 * is emailed, signs in, chooses billing and pays; nothing is charged here.
 */
export async function approve(id: string, note: string | undefined, ctx: AuditContext,): Promise<MembershipApplication> {
    const a = await loadPending(id,);
    const claimedAt = await claimForApproval(id,);
    try {
        return await approveClaimed(a, id, note, ctx, claimedAt,);
    } finally {
        await releaseClaim(id,);
    }
}

async function approveClaimed(a: Awaited<ReturnType<typeof loadPending>>, id: string, note: string | undefined, ctx: AuditContext, claimedAt: Date,): Promise<MembershipApplication> {
    const tier = (await query<{ hide_price: boolean; name: string; role_only: boolean; role: string | null; }>(`SELECT hide_price, name, role_only, role FROM subscription_plans WHERE id = $1`, [a.plan_id,],)).rows[0];
    if (tier?.role_only) return approveProgram(a, id, tier, note, ctx,);
    if (tier?.hide_price && !a.payment_method_id) {
        await query(
            `UPDATE membership_applications SET status = 'approved', note = $2, error = NULL, decided_by = $3, decided_at = NOW(), updated_at = NOW(),
                    offer_expires_at = NOW() + make_interval(days => $4) WHERE id = $1`,
            [id, note?.trim() || null, ctx.userId || null, OFFER_TTL_DAYS,],
        );
        if (a.user_id) await setUserApproval(a.user_id, 'approved',);
        await logAudit({ userId: ctx.userId, action: 'approve', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, offer: true, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
        const app = await get(id,);
        if (app.contactEmail) {
            // An account-less applicant gets a fresh claim link (the token is the credential).
            const url = claimUrl(id, a.plan_id, a.user_id ? null : applicationToken(id,),);
            const until = new Date(Date.now() + OFFER_TTL_DAYS * 86400_000,).toLocaleDateString('en-US', { dateStyle: 'long', },);
            void sendPurposeMail('membership_application_approved', {
                to: app.contactEmail,
                context: {
                    user: { name: app.user?.displayName ?? '', email: app.contactEmail, },
                    tier: { name: tier.name, },
                    application: { claimUrl: url, offer: 'yes', offerExpires: until, },
                    note: note?.trim() ?? '',
                },
            },).catch(() => {},);
        }
        return app;
    }
    if (!a.user_id) throw new ValidationError('The applicant has not created their account yet — approve once they have signed up and added a card.',);
    try {
        await startApprovedMembership(a.user_id!, a.plan_id, a.payment_method_id, a.price_id, { idempotencyKey: `approve:${id}:${claimedAt.getTime()}`, },);
    } catch (e) {
        const message = (e as Error).message;
        await query(`UPDATE membership_applications SET error = $2, updated_at = NOW() WHERE id = $1`, [id, message,],);
        throw e instanceof ValidationError ? e : new ValidationError(message,);
    }
    await query(
        `UPDATE membership_applications SET status = 'approved', note = $2, error = NULL, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id, note?.trim() || null, ctx.userId || null,],
    );
    await setUserApproval(a.user_id!, 'approved',);
    await logAudit({ userId: ctx.userId, action: 'approve', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(id,);
}

/**
 * Withdraw an approved OFFER that the member has not started (hide-price
 * levels). `reject` refuses it because it is no longer pending.
 */
export async function withdrawOffer(id: string, ctx: AuditContext,): Promise<MembershipApplication> {
    const r = await query<{ user_id: string | null; plan_id: string; }>(
        `UPDATE membership_applications SET status = 'withdrawn', updated_at = NOW()
          WHERE id = $1 AND status = 'approved' AND activated_at IS NULL RETURNING user_id, plan_id`,
        [id,],
    );
    const row = r.rows[0];
    if (!row) throw new ValidationError('Only an approved offer that was not started yet can be withdrawn.',);
    if (row.user_id) await setUserApproval(row.user_id, null,);
    await logAudit({ userId: ctx.userId, action: 'withdraw_offer', entityType: 'membership_application', entityId: id, newValues: { tierId: row.plan_id, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return get(id,);
}

/** Reject: nothing is charged; the member is told. */
export async function reject(id: string, note: string | undefined, ctx: AuditContext,): Promise<MembershipApplication> {
    const a = await loadPending(id,);
    await query(
        `UPDATE membership_applications SET status = 'rejected', note = $2, decided_by = $3, decided_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [id, note?.trim() || null, ctx.userId || null,],
    );
    if (a.user_id) await setUserApproval(a.user_id, 'rejected',);
    await logAudit({ userId: ctx.userId, action: 'reject', entityType: 'membership_application', entityId: id, newValues: { tierId: a.plan_id, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    const app = await get(id,);
    if (app.contactEmail) {
        void sendPurposeMail('membership_application_rejected', {
            to: app.contactEmail,
            context: {
                user: { name: app.user?.displayName ?? '', email: app.contactEmail, },
                tier: { name: app.tierName, },
                note: note?.trim() ?? '',
                // The "your card was not charged" line only when a card was saved.
                application: { program: app.tierRoleOnly ? 'yes' : '', card: (a as { payment_method_id?: string | null; }).payment_method_id ? 'yes' : '', },
            },
        },).catch(() => {},);
    }
    return app;
}

/**
 * The member withdraws their own pending application: `applicationId` = that
 * one; none = their pending MEMBERSHIP application (program applications are
 * withdrawn one by one). The team gets a "withdrawn" notice per application.
 */
export async function withdraw(userId: string, applicationId?: string | null,): Promise<void> {
    const r = await query<{ id: string; plan_id: string; }>(
        `UPDATE membership_applications SET status = 'withdrawn', updated_at = NOW()
          WHERE user_id = $1 AND status = 'pending' AND (CASE WHEN $2::uuid IS NULL THEN program = false ELSE id = $2::uuid END)
          RETURNING id, plan_id`,
        [userId, applicationId ?? null,],
    );
    if (applicationId && !r.rows.length) throw new NotFoundError('Pending application',);
    if (!r.rows.length) return;
    await setUserApproval(userId, null,);
    for (const row of r.rows) {
        const tierName = (await query<{ name: string; }>(`SELECT name FROM subscription_plans WHERE id = $1`, [row.plan_id,],)).rows[0]?.name ?? 'membership';
        applicationFollowUp(row.id, userId, tierName, 'withdrawn',);
    }
}

/**
 * The member's PROGRAMS ("Add its role only" levels) — every program they hold
 * the role of or have applied to, with the latest application's state, for
 * Profile → Membership → Programs.
 */
export async function myPrograms(userId: string,): Promise<MembershipProgramStatus[]> {
    const [plans, apps, user,] = await Promise.all([
        query<{ id: string; name: string; slug: string | null; description: string | null; role: string | null; }>(
            `SELECT id, name, slug, description, role FROM subscription_plans WHERE role_only = true AND is_active IS NOT FALSE ORDER BY sort_order, name`,
        ),
        query<{ id: string; plan_id: string; status: string; created_at: Date; decided_at: Date | null; }>(
            `SELECT DISTINCT ON (plan_id) id, plan_id, status, created_at, decided_at FROM membership_applications
              WHERE user_id = $1 ORDER BY plan_id, created_at DESC`,
            [userId,],
        ),
        query<{ role: string; extra_roles: string[] | null; }>(`SELECT role, extra_roles FROM users WHERE id = $1`, [userId,],),
    ],);
    const held = new Set([user.rows[0]?.role, ...(user.rows[0]?.extra_roles ?? []),].filter(Boolean,),);
    const out: MembershipProgramStatus[] = [];
    for (const p of plans.rows) {
        const a = apps.rows.find((x,) => x.plan_id === p.id,);
        const member = !!p.role && held.has(p.role,);
        if (!member && !a) continue;
        out.push({
            tierId: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            role: p.role,
            status: member ? 'member' : (a!.status === 'approved' ? 'withdrawn' : a!.status as MembershipProgramStatus['status']),
            applicationId: a?.id ?? null,
            appliedAt: a ? new Date(a.created_at,).toISOString() : null,
            decidedAt: a?.decided_at ? new Date(a.decided_at,).toISOString() : null,
        },);
    }
    return out;
}

/** The member leaves a program: its role is removed; the team is told. */
export async function leaveProgram(userId: string, tierId: string,): Promise<void> {
    const t = (await query<{ name: string; role: string | null; role_only: boolean; }>(
        `SELECT name, role, role_only FROM subscription_plans WHERE id = $1`, [tierId,],
    )).rows[0];
    if (!t?.role_only || !t.role) throw new NotFoundError('Program',);
    const u = (await query<{ extra_roles: string[] | null; }>(`SELECT extra_roles FROM users WHERE id = $1`, [userId,],)).rows[0];
    if (!u?.extra_roles?.includes(t.role,)) throw new ValidationError(`You are not part of ${t.name}.`,);
    const { setExtraRoles, } = await import('./users.js');
    await setExtraRoles(userId, u.extra_roles.filter((r,) => r !== t.role,),);
    // The approval stays on record as withdrawn, so the program reads "Left".
    const app = await query<{ id: string; }>(
        `UPDATE membership_applications SET status = 'withdrawn', updated_at = NOW()
          WHERE id = (SELECT id FROM membership_applications WHERE user_id = $1 AND plan_id = $2 AND status = 'approved' ORDER BY created_at DESC LIMIT 1)
          RETURNING id`,
        [userId, tierId,],
    );
    await logAudit({ userId, action: 'leave_program', entityType: 'membership_application', entityId: app.rows[0]?.id ?? tierId, newValues: { tierId, role: t.role, }, },);
    applicationFollowUp(app.rows[0]?.id ?? null, userId, t.name, 'left',);
}
