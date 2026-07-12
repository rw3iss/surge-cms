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
import { z, } from 'zod';
import type {
    AssertCompatible,
    PaymentsDonateBody,
    PaymentsPlanCreateBody,
    PaymentsSubscribeBody,
    PaymentsTransactionsQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as payments from '../services/payments';

const donateSchema = z.object({
    amountCents: z.number().int().min(100,),
    campaignId: z.string().uuid().optional(),
    donorName: z.string().optional(),
    donorEmail: z.string().email(),
    message: z.string().max(500,).optional(),
    visibility: z.enum(['public', 'anonymous', 'hidden',],).optional(),
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
];
