import rateLimit, { ipKeyGenerator, } from 'express-rate-limit';
import { RedisRateLimitStore, } from '../middleware/rateLimitStore';
import * as applications from '../services/membershipApplications';
import type { MembershipApplyBody, MembershipApplySubmitBody, } from '@sitesurge/types';
/**
 * Payment routes (Stripe). Thin shell over `services/payments.ts`.
 *
 *   POST   /create-customer            — user: ensure a Stripe customer
 *   POST   /donate                     — optional: donation intent (anon ok)
 *   POST   /subscribe                  — user: start a subscription
 *   POST   /unsubscribe                — user: cancel at period end
 *   GET    /subscriptions              — user: own subscriptions
 *   GET    /transactions               — user: own transaction history
 *   POST   /webhook                    — public, RAW: Stripe webhook
 *   GET    /admin/subscriptions        — admin
 *   GET    /admin/transactions         — admin
 *   GET    /admin/user/:userId/transactions — admin
 *   GET    /admin/plans                — admin
 *   POST   /admin/plans                — admin
 *   PUT    /admin/plans/:id            — admin
 *   GET    /plans                      — public: active plans
 *
 * The webhook route stays `raw: true` and reads req.body as a Buffer for
 * signature verification — app.ts mounts express.raw for
 * /api/v1/payments/webhook BEFORE express.json, so the body is never
 * mutated. The route only forwards the buffer + signature to the service
 * and echoes back the status/body the service returns (200 fast, 400 on
 * bad signature) to honour Stripe's contract exactly.
 */
import type { RecurringDonationUpdateBody, } from '@sitesurge/types';
import { z, } from 'zod';
import * as permissions from '../services/permissions';
import * as recurring from '../services/recurringDonations';
import { requireFeature, } from '../api/requireFeature';
import type {
    AssertCompatible,
    PaymentsDonateBody,
    PaymentsPlanCreateBody,
    PaymentsSubscribeBody,
    PaymentsTransactionsQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as payments from '../services/payments';
import { stripeCredentials, } from '../services/payment/credentials';
import * as membership from '../services/membership';
import type { MembershipCardBody, MembershipChangeBody, MembershipConfirmBody, } from '@sitesurge/types';

const publishableKeyQuery = z.object({
    context: z.enum(['default', 'shop', 'donations',],).optional(),
},);

const donateSchema = z.object({
    amountCents: z.number().int().min(100,),
    campaignId: z.string().uuid().optional(),
    donorName: z.string().optional(),
    donorEmail: z.string().email(),
    message: z.string().max(500,).optional(),
    visibility: z.enum(['public', 'anonymous', 'hidden',],).optional(),
    recurringInterval: z.enum(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly',],).optional(),
},) satisfies z.ZodType<PaymentsDonateBody>;

const subscribeSchema = z.object({
    planId: z.string().uuid(),
},) satisfies z.ZodType<PaymentsSubscribeBody>;

const planSchema = z.object({
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    priceCents: z.number().int().positive(),
    interval: z.enum(['month', 'year',],).optional(),
    features: z.array(z.string(),).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
},) satisfies z.ZodType<PaymentsPlanCreateBody>;

const pageQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

// Query coerces (string → number), so assert z.infer compatibility.
type _AssertPaymentsPageQuery = AssertCompatible<z.infer<typeof pageQuery>, PaymentsTransactionsQuery>;

/** Membership application submits: 10 per IP per hour (Redis-backed, so the ceiling holds across workers). */
const applicationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    store: new RedisRateLimitStore('rl:apply:',),
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many applications from this network. Please try again later.', }, },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req,) => (req.ip ? ipKeyGenerator(req.ip,) : 'unknown'),
},);

export const paymentsRoutes = [

    defineRoute({
        method: 'post', path: '/create-customer', auth: 'user',
        summary: 'Create or retrieve the logged-in user\'s Stripe customer.',
        handler: ({ userId, },) => payments.createCustomer(userId!,),
    },),

    defineRoute({
        method: 'post', path: '/donate', auth: 'optional',
        summary: 'Create a donation payment intent (anonymous donations allowed).',
        input: { body: donateSchema, },
        handler: ({ body, userId, },) => payments.donate(body, userId,),
    },),

    defineRoute({
        method: 'post', path: '/subscribe', auth: 'user',
        summary: 'Start a subscription for the logged-in user.',
        input: { body: subscribeSchema, },
        handler: ({ body, userId, },) => payments.subscribe(userId!, body.planId,),
    },),

    defineRoute({
        method: 'post', path: '/unsubscribe', auth: 'user',
        summary: 'Cancel the user\'s active subscription at period end.',
        handler: ({ userId, },) => payments.unsubscribe(userId!,),
    },),

    // ─── Membership (own subscription tier — profile → Membership) ───
    defineRoute({
        method: 'get', path: '/membership/tiers', auth: 'optional',
        summary: 'Public tier catalogue for /subscribe: every active tier (free included) with price + description; isCurrent for the signed-in viewer.',
        handler: ({ userId, },) => membership.publicTiers(userId ?? null,),
    },),
    defineRoute({
        method: 'get', path: '/membership', auth: 'user',
        summary: "The user's current tier (incl. free) + the tiers they can switch to.",
        handler: ({ userId, },) => membership.overview(userId!,),
    },),
    defineRoute({
        method: 'post', path: '/membership/preview', auth: 'user',
        summary: 'What a tier change would cost now (Stripe proration preview) and when it takes effect.',
        input: { body: z.object({ tierId: z.string().uuid(), priceId: z.string().max(255,).optional(), },) satisfies z.ZodType<MembershipChangeBody>, },
        handler: ({ body, userId, },) => membership.preview(userId!, body.tierId, body.priceId,),
    },),
    defineRoute({
        method: 'post', path: '/membership/change', auth: 'user',
        summary: 'Change tier: free→paid returns a clientSecret to confirm; paid→paid switches now with proration; →free cancels at period end.',
        input: { body: z.object({ tierId: z.string().uuid(), priceId: z.string().max(255,).optional(), },) satisfies z.ZodType<MembershipChangeBody>, },
        handler: ({ body, userId, },) => membership.change(userId!, body.tierId, { priceId: body.priceId, },),
    },),
    defineRoute({
        method: 'post', path: '/membership/confirm', auth: 'user',
        summary: "Activate a new subscription after the browser confirmed its first payment.",
        input: { body: z.object({ subscriptionId: z.string().max(255,), },) satisfies z.ZodType<MembershipConfirmBody>, },
        handler: ({ body, userId, },) => membership.confirm(userId!, body.subscriptionId,),
    },),
    defineRoute({
        method: 'post', path: '/membership/apply', auth: 'user',
        summary: 'Apply for a membership level that requires approval: the answers + a card saved with a SetupIntent (charged only on approval).',
        input: {
            body: z.object({
                tierId: z.string().uuid(),
                priceId: z.string().max(255,).optional(),
                answers: z.array(z.object({ questionId: z.string().max(100,), value: z.unknown(), },),).max(100,),
                paymentMethodId: z.string().min(3,).max(255,),
            },),
        },
        handler: async ({ body, user, audit, },) => {
            const a = audit();
            return applications.apply(body as MembershipApplyBody, { userId: user!.id, email: user!.email, ipAddress: a.ipAddress ?? '', userAgent: a.userAgent, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/membership/apply/submit', auth: 'optional',
        summary: 'Step 1 of applying: the answers, signed in or not. The team is emailed now; a signed-out applicant gets a token to claim it after creating an account.',
        // Anonymous + sends mail: rate-limited per IP (shared across workers),
        // a honeypot field, and one pending row per (email, level) in the service.
        pre: [applicationLimiter,],
        input: {
            body: z.object({
                tierId: z.string().uuid(),
                priceId: z.string().max(255,).optional(),
                answers: z.array(z.object({ questionId: z.string().max(100,), value: z.unknown(), },),).max(100,),
                website: z.string().max(500,).optional(),
            },),
        },
        handler: async ({ body, user, audit, },) => {
            const a = audit();
            return applications.submit(body as MembershipApplySubmitBody, { userId: user?.id ?? null, email: user?.email ?? null, ipAddress: a.ipAddress ?? '', userAgent: a.userAgent, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/membership/apply/card', auth: 'user',
        summary: 'Step 2 of applying: claim the application (token) and save the card — no charge until approved.',
        input: {
            body: z.object({
                applicationId: z.string().uuid(),
                token: z.string().max(300,).nullable().optional(),
                paymentMethodId: z.string().min(3,).max(255,),
            },),
        },
        handler: ({ body, userId, },) => applications.attachCard(userId!, body,),
    },),
    defineRoute({
        method: 'post', path: '/membership/apply/claim', auth: 'user',
        summary: 'Attach an application submitted before the account existed (token) — no card; for levels that hide their price.',
        input: { body: z.object({ applicationId: z.string().uuid(), token: z.string().max(300,).nullable().optional(), },), },
        handler: ({ body, userId, },) => applications.claim(userId!, body,),
    },),
    defineRoute({
        method: 'post', path: '/membership/apply/withdraw', auth: 'user',
        summary: 'Withdraw your own pending membership application.',
        handler: async ({ userId, },) => {
            await applications.withdraw(userId!,);
            return { ok: true, };
        },
    },),
    defineRoute({
        method: 'post', path: '/membership/cancel', auth: 'user',
        summary: 'Cancel the paid subscription at the end of the paid period (subscription-required mode hides Free, so this replaces "switch to free").',
        handler: ({ userId, },) => membership.cancel(userId!,),
    },),
    defineRoute({
        method: 'post', path: '/membership/card/setup', auth: 'user',
        summary: 'Start a payment-card change: a Stripe SetupIntent client secret to confirm with the new card.',
        handler: ({ userId, },) => membership.cardSetup(userId!,),
    },),
    defineRoute({
        method: 'post', path: '/membership/card', auth: 'user',
        summary: 'Save the confirmed card as the default for the membership; retries a past-due invoice.',
        input: { body: z.object({ paymentMethodId: z.string().min(3,).max(255,), },) satisfies z.ZodType<MembershipCardBody>, },
        handler: ({ body, userId, },) => membership.updateCard(userId!, body.paymentMethodId,),
    },),
    defineRoute({
        method: 'post', path: '/membership/resume', auth: 'user',
        summary: 'Undo a scheduled cancellation.',
        handler: ({ userId, },) => membership.resume(userId!,),
    },),

    defineRoute({
        method: 'get', path: '/subscriptions', auth: 'user',
        summary: 'List the logged-in user\'s subscriptions.',
        handler: ({ userId, },) => payments.listUserSubscriptions(userId!,),
    },),

    defineRoute({
        method: 'get', path: '/transactions', auth: 'user',
        summary: 'List the logged-in user\'s transaction history.',
        input: { query: pageQuery, },
        handler: async ({ userId, query, },) => {
            const result = await payments.listUserTransactions(userId!, query.page, query.limit,);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // ─── Recurring donations (the donor's own; Stripe does the billing) ───
    defineRoute({
        method: 'get', path: '/recurring-donations', auth: 'user', pre: [requireFeature('campaigns',),],
        summary: "The signed-in donor's recurring donations, read live from Stripe.",
        handler: ({ user, },) => recurring.listForDonor({ id: user!.id, email: user!.email, },),
    },),

    defineRoute({
        method: 'put', path: '/recurring-donations/:id', auth: 'user', pre: [requireFeature('campaigns',),],
        summary: 'Change the amount and/or frequency of your recurring donation (from the next charge).',
        input: {
            params: z.object({ id: z.string().regex(/^sub_[A-Za-z0-9]+$/,), },),
            body: z.object({
                amountCents: z.number().int().min(100,).max(10_000_000,).optional(),
                interval: z.enum(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly',],).optional(),
            },) satisfies z.ZodType<RecurringDonationUpdateBody>,
        },
        handler: async ({ user, params, body, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, 'campaigns.donations:manage_own',);
            return recurring.update({ id: user!.id, email: user!.email, }, params.id, body,);
        },
    },),

    defineRoute({
        method: 'post', path: '/recurring-donations/:id/cancel', auth: 'user', pre: [requireFeature('campaigns',),],
        summary: 'Cancel your recurring donation now (no further charges).',
        input: { params: z.object({ id: z.string().regex(/^sub_[A-Za-z0-9]+$/,), },), },
        handler: async ({ user, params, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, 'campaigns.donations:manage_own',);
            return recurring.cancel({ id: user!.id, email: user!.email, }, params.id,);
        },
    },),

    defineRoute({
        method: 'get', path: '/donations', auth: 'user',
        summary: 'List the logged-in user\'s completed donations (by their id OR email).',
        input: { query: pageQuery, },
        handler: async ({ user, query, },) => {
            // userId + email come from the AUTH TOKEN only — never client input.
            const result = await payments.listMyDonations(user!.id, user!.email, query.page, query.limit,);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'post', path: '/webhook', auth: 'public', raw: true,
        summary: 'Stripe webhook (raw body, signature-verified). Always 200 unless bad signature (400).',
        handler: async ({ req, res, },) => {
            const sig = req.headers['stripe-signature'] as string | undefined;
            // req.body is a Buffer here — app.ts mounts express.raw for
            // this exact path before express.json. Forward it untouched.
            const result = await payments.handleWebhook(req.body, sig,);
            res.status(result.status,).json(result.body,);
        },
    },),

    defineRoute({
        method: 'get', path: '/admin/subscriptions', auth: 'admin',
        summary: 'List all subscriptions (admin).',
        input: { query: pageQuery.extend({ status: z.string().optional(), },), },
        handler: async ({ query, },) => {
            const result = await payments.adminListSubscriptions(query.status, query.page, query.limit,);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/admin/transactions', auth: 'admin',
        summary: 'List all transactions (admin; type/status filters).',
        input: { query: pageQuery.extend({ type: z.string().optional(), status: z.string().optional(), },), },
        handler: async ({ query, },) => {
            const result = await payments.adminListTransactions(
                { type: query.type, status: query.status, },
                query.page, query.limit,
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/admin/user/:userId/transactions', auth: 'admin',
        summary: 'List a specific user\'s transactions (admin).',
        input: { params: z.object({ userId: z.string(), },), query: pageQuery, },
        handler: async ({ params, query, },) => {
            const result = await payments.adminListUserTransactions(params.userId, query.page, query.limit,);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/admin/plans', auth: 'admin',
        summary: 'List all subscription plans (admin).',
        handler: () => payments.adminListPlans(),
    },),

    defineRoute({
        method: 'post', path: '/admin/plans', auth: 'admin',
        summary: 'Create a subscription plan (creates a Stripe product + price).',
        input: { body: planSchema, },
        handler: async ({ body, },) => {
            const plan = await payments.createPlan(body,);
            return reply(plan, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/admin/plans/:id', auth: 'admin',
        summary: 'Update a subscription plan (admin).',
        input: { params: z.object({ id: z.string(), },), body: planSchema.partial(), },
        handler: ({ params, body, },) => payments.updatePlan(params.id, body,),
    },),

    defineRoute({
        method: 'get', path: '/plans', auth: 'public',
        summary: 'List active subscription plans (public subscribe page).',
        handler: () => payments.publicPlans(),
    },),

    // Publishable key for a payment context (public by design) — lets the
    // donation / subscription forms load Stripe Elements with the right account.
    defineRoute({
        method: 'get', path: '/publishable-key', auth: 'public',
        summary: 'Resolved Stripe publishable key for a payment context (default | shop | donations).',
        input: { query: publishableKeyQuery, },
        handler: ({ query, },) => ({ publishableKey: stripeCredentials(query.context ?? 'default',).publishableKey || null, }),
    },),
];
