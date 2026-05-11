/**
 * Admin + public routes for mailing lists and subscribers.
 *
 * Mount point under /api/v1/mailing-lists:
 *   ADMIN (authenticated):
 *     GET    /                                    — list all
 *     POST   /                                    — create
 *     GET    /:id                                 — fetch one
 *     PUT    /:id                                 — update
 *     DELETE /:id                                 — remove
 *     GET    /:id/subscribers                     — paginated subscribers
 *     POST   /:id/subscribers                     — admin add (force confirmed)
 *     PUT    /:id/subscribers/:subId              — update subscriber
 *     DELETE /:id/subscribers/:subId              — remove one
 *     POST   /:id/subscribers/bulk-delete         — { ids }
 *     POST   /:id/subscribers/:subId/force-confirm — flip pending → subscribed
 *
 *   PUBLIC (mounted at /api/v1/lists/:slug under a sibling router):
 *     POST   /:slug/subscribe                     — { email, name?, phone?, customFields? }
 *
 * (Token-based unsubscribe lives in routes/unsubscribe.ts, mounted at
 * the public root.)
 */
import { randomBytes, } from 'crypto';
import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { NotFoundError, ValidationError, } from '../middleware/error';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { sendEmail, } from '../services/email';
import { config, } from '../config';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';

const router = Router();

const listSchema = z.object({
    slug: z.string().min(1,).max(64,).regex(/^[a-z0-9-]+$/,),
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    isEnabled: z.boolean().optional(),
    registeredUsersOnly: z.boolean().optional(),
    doubleOptIn: z.boolean().optional(),
    defaultTemplateId: z.string().uuid().nullable().optional(),
},);

const subscriberAdminSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown(),).optional(),
},);

router.get('/', authenticate(), requireAdmin, async (_req, res,) => {
    try {
        sendSuccess(res, await lists.list(),);
    } catch (e) { handleRouteError(res, e, 'list mailing lists',); }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = listSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);
        const created = await lists.create({ ...parsed.data, createdBy: req.userId!, },);
        await cache.invalidateMailingListsCache();
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'mailing_list',
            entityId: created.id,
            newValues: { ...created, } as unknown as Record<string, unknown>,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, created,);
    } catch (e) { handleRouteError(res, e, 'create mailing list',); }
},);

router.get('/:id', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const item = await lists.findById(req.params.id,);
        if (!item) throw new NotFoundError('Mailing list not found',);
        sendSuccess(res, item,);
    } catch (e) { handleRouteError(res, e, 'fetch mailing list',); }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = listSchema.partial().safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);
        const updated = await lists.update(req.params.id, parsed.data,);
        if (!updated) throw new NotFoundError('Mailing list not found',);
        await cache.invalidateMailingListsCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'mailing_list',
            entityId: req.params.id,
            newValues: parsed.data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, updated,);
    } catch (e) { handleRouteError(res, e, 'update mailing list',); }
},);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await lists.remove(req.params.id,);
        await cache.invalidateMailingListsCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'mailing_list',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { ok: true, },);
    } catch (e) { handleRouteError(res, e, 'delete mailing list',); }
},);

router.get('/:id/subscribers', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit,) : undefined;
        const offset = req.query.offset ? Number(req.query.offset,) : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const status = typeof req.query.status === 'string'
            ? (req.query.status as Parameters<typeof subs.list>[0]['status'])
            : undefined;
        const r = await subs.list({ listId: req.params.id, limit, offset, search, status, },);
        sendSuccess(res, r,);
    } catch (e) { handleRouteError(res, e, 'list subscribers',); }
},);

router.post('/:id/subscribers', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = subscriberAdminSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);
        const existing = await subs.findByEmail(req.params.id, parsed.data.email,);
        if (existing) {
            // Idempotent: re-add reactivates.
            if (existing.status !== 'subscribed') await subs.setStatus(existing.id, 'subscribed',);
            return sendSuccess(res, existing,);
        }
        const created = await subs.create({
            listId: req.params.id,
            email: parsed.data.email,
            name: parsed.data.name,
            phone: parsed.data.phone,
            customFields: parsed.data.customFields,
            status: 'subscribed',
        },);
        sendCreated(res, created,);
    } catch (e) { handleRouteError(res, e, 'add subscriber',); }
},);

router.put('/:id/subscribers/:subId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const updated = await subs.update(req.params.subId, req.body,);
        if (!updated) throw new NotFoundError('Subscriber not found',);
        sendSuccess(res, updated,);
    } catch (e) { handleRouteError(res, e, 'update subscriber',); }
},);

router.delete('/:id/subscribers/:subId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await subs.remove(req.params.subId,);
        sendSuccess(res, { ok: true, },);
    } catch (e) { handleRouteError(res, e, 'remove subscriber',); }
},);

router.post('/:id/subscribers/bulk-delete', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const ids = Array.isArray(req.body?.ids,) ? req.body.ids as string[] : [];
        await subs.bulkRemove(ids,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'mailing_list_subscribers',
            entityId: req.params.id,
            newValues: { count: ids.length, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { removed: ids.length, },);
    } catch (e) { handleRouteError(res, e, 'bulk-delete subscribers',); }
},);

router.post('/:id/subscribers/:subId/force-confirm', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const sub = await subs.findById(req.params.subId,);
        if (!sub) throw new NotFoundError('Subscriber not found',);
        await subs.setStatus(sub.id, 'subscribed',);
        await subs.clearConfirmationToken(sub.id,);
        const fresh = await subs.findById(sub.id,);
        sendSuccess(res, fresh,);
    } catch (e) { handleRouteError(res, e, 'force confirm',); }
},);

export default router;

// ─── Public subscribe sub-router ─────────────────────────────────────
// Mounted separately at /api/v1/lists so the URL shape is short and
// matches the unsubscribe URL pattern (/u/:token, /lists/:slug/confirm).

export const publicMailingListsRouter = Router();

const subscribeSchema = z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    customFields: z.record(z.string(), z.unknown(),).optional(),
},);

publicMailingListsRouter.post(
    '/:slug/subscribe',
    authenticate(false,),
    async (req: AuthenticatedRequest, res,) => {
        try {
            const list = await lists.findBySlug(req.params.slug,);
            if (!list || !list.isEnabled) throw new NotFoundError('List not found',);
            const parsed = subscribeSchema.safeParse(req.body,);
            if (!parsed.success) throw new ValidationError('Invalid input', { issues: parsed.error.issues, },);

            let email = parsed.data.email;
            let userId: string | null = null;

            if (list.registeredUsersOnly) {
                if (!req.userId || !req.user) {
                    throw new ValidationError('Login required to subscribe to this list',);
                }
                email = req.user.email;
                userId = req.userId;
            }
            if (!email) throw new ValidationError('Email is required',);

            const existing = await subs.findByEmail(list.id, email,);
            const wantsDoubleOpt = list.doubleOptIn;
            const targetStatus = wantsDoubleOpt ? 'pending_confirmation' : 'subscribed';

            if (existing) {
                if (existing.status === 'subscribed') {
                    return sendSuccess(res, { status: 'subscribed', already: true, },);
                }
                await subs.setStatus(existing.id, targetStatus,);
                return sendSuccess(res, { status: targetStatus, already: true, },);
            }

            const confirmationToken = wantsDoubleOpt ? randomBytes(24,).toString('base64url',) : null;
            const created = await subs.create({
                listId: list.id,
                email,
                userId,
                name: parsed.data.name,
                phone: parsed.data.phone,
                customFields: parsed.data.customFields,
                status: targetStatus,
                confirmationToken,
            },);

            // Fire the double-opt-in confirmation email if needed.
            // Failures don't roll back the subscription — the operator
            // can resend or force-confirm from the admin UI.
            if (wantsDoubleOpt && confirmationToken) {
                try {
                    const fe = (config.frontendUrl as string | undefined) ?? '';
                    const confirmUrl = `${fe}/lists/${encodeURIComponent(list.slug,)}/confirm/${encodeURIComponent(confirmationToken,)}`;
                    await sendEmail({
                        to: email,
                        subject: `Confirm your subscription to ${list.name}`,
                        html: `
                            <h1>One more step</h1>
                            <p>Click the button below to confirm your subscription to <strong>${list.name}</strong>:</p>
                            <p style="text-align:center;padding:1rem 0">
                                <a href="${confirmUrl}" style="background:#3498cf;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Confirm subscription</a>
                            </p>
                            <p>Or copy and paste this URL into your browser:<br><code>${confirmUrl}</code></p>
                            <p>If you didn't subscribe, you can safely ignore this email.</p>
                        `,
                    },);
                } catch (mailErr) {
                    // Log but don't fail the request. Operator gets a
                    // "Force confirm" button in the admin UI for the
                    // pending row if the email never lands.
                    // eslint-disable-next-line no-console
                    console.warn('Failed to send double-opt-in confirmation', mailErr,);
                }
            }

            sendSuccess(res, { status: created.status, id: created.id, },);
        } catch (e) { handleRouteError(res, e, 'public subscribe',); }
    },
);
