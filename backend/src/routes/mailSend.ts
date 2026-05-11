/**
 * Send wizard endpoints + job status / retry / cancel.
 *
 *   POST   /send                  — create job + recipients, kick worker
 *   GET    /jobs/:id              — job status snapshot
 *   GET    /jobs/:id/recipients   — paginated recipient list
 *   POST   /jobs/:id/retry        — reset failed → pending, re-kick
 *   PATCH  /jobs/:id              — { status: 'cancelled' }
 */
import { Router, } from 'express';
import { z, } from 'zod';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { NotFoundError, ValidationError, } from '../middleware/error';
import * as jobs from '../repositories/mailSendJobs.repo';
import * as recipients from '../repositories/mailSendRecipients.repo';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import * as templateBlocks from '../repositories/mailTemplateBlocks.repo';
import { logAudit, } from '../services/audit';
import { renderMailHtml, } from '../services/mail/renderer';
import { kickJob, } from '../services/mail/sendWorker';
import { loadMailRenderContext, } from '../services/mail/siteContext';
import { handleRouteError, sendCreated, sendSuccess, } from '../utils/response';

const router = Router();

const blockSchema = z.object({
    id: z.string().uuid().optional(),
    parentBlockId: z.string().uuid().nullable().optional(),
    blockType: z.string().min(1,),
    position: z.number().int().min(0,),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},);

const sendSchema = z.object({
    listId: z.string().uuid(),
    templateId: z.string().uuid().nullable().optional(),
    subject: z.string().min(1,).max(1000,),
    preheader: z.string().max(255,).optional(),
    fromName: z.string().max(255,).optional(),
    fromEmail: z.string().email().optional(),
    replyTo: z.string().email().optional(),
    blocks: z.array(blockSchema,),
},);

router.post('/send', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = sendSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid send input', { issues: parsed.error.issues, },);

        const list = await lists.findById(parsed.data.listId,);
        if (!list || !list.isEnabled) throw new ValidationError('List not found or disabled',);

        // Resolve site palette + identity from site_settings so the
        // renderer can substitute CSS variables to literal values.
        const renderCtx = await loadMailRenderContext();

        // Render once. Tokens `{{...}}` survive into the output and
        // get per-recipient substituted by the worker.
        const blocksForRender = parsed.data.blocks.map((b, i,) => ({
            id: b.id ?? `send-${i}`,
            parentBlockId: b.parentBlockId ?? null,
            blockType: b.blockType,
            position: b.position,
            settings: (b.settings ?? {}) as Record<string, unknown>,
            style: (b.style ?? {}) as Record<string, unknown>,
        }));
        const resolvedBlocks = await templateBlocks.populateBlockStyles(blocksForRender,);
        const rendered = renderMailHtml({
            blocks: resolvedBlocks,
            subject: parsed.data.subject,
            preheader: parsed.data.preheader,
            ...renderCtx,
        },);

        const subscribed = await subs.listSubscribedForSend(list.id,);

        const job = await jobs.create({
            listId: list.id,
            templateId: parsed.data.templateId ?? null,
            subject: parsed.data.subject,
            preheader: parsed.data.preheader,
            fromName: parsed.data.fromName,
            fromEmail: parsed.data.fromEmail,
            replyTo: parsed.data.replyTo,
            renderedHtmlTemplate: rendered.html,
            totalRecipients: subscribed.length,
            createdBy: req.userId!,
        },);

        if (subscribed.length > 0) {
            await recipients.bulkInsert(
                job.id,
                subscribed.map((s,) => ({ subscriberId: s.id, email: s.email, }),),
            );
        }

        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'mail_send_job',
            entityId: job.id,
            newValues: { listId: list.id, total: subscribed.length, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);

        // Fire-and-forget worker kick. We return 202 immediately.
        setImmediate(() => { void kickJob(job.id,); },);

        res.status(202,).json({ success: true, data: { jobId: job.id, total: subscribed.length, }, },);
    } catch (e) { handleRouteError(res, e, 'send mail',); }
},);

router.get('/jobs', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit,) : undefined;
        const offset = req.query.offset ? Number(req.query.offset,) : undefined;
        sendSuccess(res, await jobs.listRecent(limit, offset,),);
    } catch (e) { handleRouteError(res, e, 'list jobs',); }
},);

router.get('/jobs/:id', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const j = await jobs.findById(req.params.id,);
        if (!j) throw new NotFoundError('Job not found',);
        sendSuccess(res, j,);
    } catch (e) { handleRouteError(res, e, 'fetch job',); }
},);

router.get('/jobs/:id/recipients', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit,) : undefined;
        const offset = req.query.offset ? Number(req.query.offset,) : undefined;
        const status = typeof req.query.status === 'string'
            ? (req.query.status as Parameters<typeof recipients.list>[0]['status'])
            : undefined;
        const r = await recipients.list({ jobId: req.params.id, limit, offset, status, },);
        sendSuccess(res, r,);
    } catch (e) { handleRouteError(res, e, 'list recipients',); }
},);

/**
 * Resume or retry. Works for:
 *   - cancelled jobs: any still-pending recipients get picked up;
 *     failed recipients are reset to pending too.
 *   - failed/completed jobs with failed recipients: failed → pending.
 *   - running/pending jobs: no-op (caller should use Cancel first).
 */
router.post('/jobs/:id/retry', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const job = await jobs.findById(req.params.id,);
        if (!job) throw new NotFoundError('Job not found',);
        if (job.status === 'running' || job.status === 'pending') {
            // Nothing to do — worker is already processing or queued.
            return sendSuccess(res, { reset: 0, },);
        }
        const reset = await recipients.resetFailedToPending(req.params.id,);
        // Adjust failed_count if we moved any back to pending, and
        // reset status to pending so the worker picks the job up.
        // cancelled jobs that had remaining pending rows are also
        // resumed by this single status flip.
        await query(
            `UPDATE mail_send_jobs
             SET failed_count = failed_count - $1,
                 status = 'pending',
                 completed_at = NULL,
                 error = NULL
             WHERE id = $2`,
            [reset, req.params.id,],
        );
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'mail_send_job',
            entityId: req.params.id,
            newValues: { resumed: true, reset, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        setImmediate(() => { void kickJob(req.params.id,); },);
        sendSuccess(res, { reset, },);
    } catch (e) { handleRouteError(res, e, 'retry job',); }
},);

const patchSchema = z.object({ status: z.enum(['cancelled',],), },);

router.patch('/jobs/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const parsed = patchSchema.safeParse(req.body,);
        if (!parsed.success) throw new ValidationError('Invalid patch', { issues: parsed.error.issues, },);
        await jobs.setStatus(req.params.id, parsed.data.status, { completedAt: new Date().toISOString(), },);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'mail_send_job',
            entityId: req.params.id,
            newValues: { status: parsed.data.status, },
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { ok: true, },);
    } catch (e) { handleRouteError(res, e, 'patch job',); }
},);

export default router;
