/**
 * Mail send service.
 *
 * Owns the send-wizard orchestration: render once, snapshot the source
 * template name, create the job + expand recipients, then kick the
 * in-process worker. Also job status, recipient pagination, retry/resume
 * and cancel. The worker itself lives in `services/mail/sendWorker.ts` —
 * this module only orchestrates the route-level flow.
 */
import { query, } from '../db';
import { NotFoundError, ValidationError, } from '../core/errors';
import * as jobs from '../repositories/mailSendJobs.repo';
import * as recipients from '../repositories/mailSendRecipients.repo';
import * as lists from '../repositories/mailingLists.repo';
import * as subs from '../repositories/mailingListSubscribers.repo';
import * as templates from '../repositories/mailTemplates.repo';
import * as templateBlocks from '../repositories/mailTemplateBlocks.repo';
import { logAudit, } from './audit';
import { renderMailHtml, } from './mail/renderer';
import { kickJob, } from './mail/sendWorker';
import { loadMailRenderContext, } from './mail/siteContext';
import type { AuditContext, } from './types';
import { uuidOrNull, } from '../utils/uuid';

export interface SendBlockInput {
    id?: string;
    parentBlockId?: string | null;
    blockType: string;
    position: number;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown>;
}

export interface SendInput {
    listId: string;
    templateId?: string | null;
    templateWasModified?: boolean;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    blocks: SendBlockInput[];
}

/** Create a send job, expand recipients, and kick the worker. Returns
 *  the job id + total recipient count (route replies 202). */
export async function send(input: SendInput, ctx: AuditContext,): Promise<{ jobId: string; total: number; }> {
    const list = await lists.findById(input.listId,);
    if (!list || !list.isEnabled) throw new ValidationError('List not found or disabled',);

    // Resolve site palette + identity from site_settings so the renderer
    // can substitute CSS variables to literal values.
    const renderCtx = await loadMailRenderContext();

    // Render once. Tokens `{{...}}` survive into the output and get
    // per-recipient substituted by the worker.
    const blocksForRender = input.blocks.map((b, i,) => ({
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
        subject: input.subject,
        preheader: input.preheader,
        ...renderCtx,
    },);

    const subscribed = await subs.listSubscribedForSend(list.id,);

    // Snapshot the source template's name now, so the job detail page can
    // still identify the source even if the template is later renamed or
    // deleted.
    let templateNameSnapshot: string | null = null;
    if (input.templateId) {
        const tpl = await templates.findById(input.templateId,);
        templateNameSnapshot = tpl?.name ?? null;
    }

    const job = await jobs.create({
        listId: list.id,
        templateId: input.templateId ?? null,
        templateNameSnapshot,
        templateWasModified: input.templateWasModified ?? false,
        subject: input.subject,
        preheader: input.preheader,
        fromName: input.fromName,
        fromEmail: input.fromEmail,
        replyTo: input.replyTo,
        renderedHtmlTemplate: rendered.html,
        totalRecipients: subscribed.length,
        // created_by is a UUID FK — synthetic actors → NULL.
        createdBy: uuidOrNull(ctx.userId,),
    },);

    if (subscribed.length > 0) {
        await recipients.bulkInsert(
            job.id,
            subscribed.map((s,) => ({ subscriberId: s.id, email: s.email, }),),
        );
    }

    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'mail_send_job',
        entityId: job.id,
        newValues: { listId: list.id, total: subscribed.length, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    // Fire-and-forget worker kick. Caller returns 202 immediately.
    setImmediate(() => { void kickJob(job.id,); },);

    return { jobId: job.id, total: subscribed.length, };
}

export function listJobs(limit?: number, offset?: number,) {
    return jobs.listRecent(limit, offset,);
}

export async function getJob(id: string,) {
    const j = await jobs.findById(id,);
    if (!j) throw new NotFoundError('Job',);
    return j;
}

export function listRecipients(
    jobId: string,
    opts: { limit?: number; offset?: number; status?: Parameters<typeof recipients.list>[0]['status']; },
) {
    return recipients.list({ jobId, limit: opts.limit, offset: opts.offset, status: opts.status, },);
}

/**
 * Resume or retry. Works for:
 *   - cancelled jobs: any still-pending recipients get picked up; failed
 *     recipients are reset to pending too.
 *   - failed/completed jobs with failed recipients: failed → pending.
 *   - running/pending jobs: no-op (caller should use Cancel first).
 */
export async function retry(id: string, ctx: AuditContext,): Promise<{ reset: number; }> {
    const job = await jobs.findById(id,);
    if (!job) throw new NotFoundError('Job',);
    if (job.status === 'running' || job.status === 'pending') {
        // Nothing to do — worker is already processing or queued.
        return { reset: 0, };
    }
    const reset = await recipients.resetFailedToPending(id,);
    // Adjust failed_count if we moved any back to pending, and reset
    // status to pending so the worker picks the job up. cancelled jobs
    // that had remaining pending rows are also resumed by this single
    // status flip.
    await query(
        `UPDATE mail_send_jobs
             SET failed_count = failed_count - $1,
                 status = 'pending',
                 completed_at = NULL,
                 error = NULL
             WHERE id = $2`,
        [reset, id,],
    );
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'mail_send_job',
        entityId: id,
        newValues: { resumed: true, reset, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    setImmediate(() => { void kickJob(id,); },);
    return { reset, };
}

export async function cancel(id: string, status: 'cancelled', ctx: AuditContext,): Promise<void> {
    await jobs.setStatus(id, status, { completedAt: new Date().toISOString(), },);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'mail_send_job',
        entityId: id,
        newValues: { status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
