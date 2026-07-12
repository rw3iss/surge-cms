/**
 * Messages service — contact form inbox (headless spec).
 *
 * Wraps `repositories/messages.repo`. Public side submits contact
 * messages (`submit` — sanitizes input + notifies admins by email);
 * admin side lists, reads, updates status, deletes, and bulk-acts.
 * The `sdk/messages.ts` shim re-exports it so `cms.messages` keeps
 * working for scripts and plugins.
 */
import type { ContactMessage, MessageStatus, } from '@sitesurge/types';
import { config, } from '../config';
import * as repo from '../repositories/messages.repo';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
import { logger, } from '../utils/logger';
import { sanitize, } from '../utils/sanitize';
import { logAudit, } from './audit';
import { sendEmail, } from './email';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { MessageFilters, } from '../repositories/messages.repo';

// ─── Reads ────────────────────────────────────────────────────────

export async function list(
    filters: repo.MessageFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<ContactMessage> & { unreadCount: number; }> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findMessages(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
        unreadCount: result.unreadCount,
    };
}

export async function getById(id: string,): Promise<ContactMessage | null> {
    try {
        return await repo.findMessageById(id,);
    } catch {
        return null;
    }
}

// ─── Writes ───────────────────────────────────────────────────────

export interface SubmitMessageInput {
    name: string;
    email: string;
    subject?: string;
    message: string;
    /** Visitor user id, when authenticated. `null` for anonymous. */
    userId?: string | null;
    ipAddress: string;
    userAgent?: string;
}

/**
 * Public message submission. Sanitizes user-supplied text, persists the
 * message, and fires an admin email notification (best-effort — a mail
 * failure is logged, not surfaced to the visitor).
 */
export async function submit(input: SubmitMessageInput,): Promise<ContactMessage> {
    const name = sanitize(input.name,);
    const message = sanitize(input.message,);
    const subject = input.subject ? sanitize(input.subject,) : undefined;

    const created = await repo.createMessage(
        { name, email: input.email, subject, message, },
        input.userId ?? null,
        input.ipAddress,
        input.userAgent,
    );

    // Send email notification to admin (best-effort).
    try {
        await sendEmail({
            to: config.adminEmails[0] || config.email.from || 'admin@example.com',
            subject: `New Contact Message: ${subject || 'No Subject'}`,
            html: `
          <h2>New Contact Message</h2>
          <p><strong>From:</strong> ${name} (${input.email})</p>
          <p><strong>Subject:</strong> ${subject || 'No Subject'}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, '<br>',)}</p>
          <hr>
          <p><small>IP: ${input.ipAddress}</small></p>
        `,
        },);
    } catch (emailError) {
        logger.warn('Failed to send email notification', { error: emailError, },);
    }

    return created;
}

export async function updateStatus(
    id: string,
    status: MessageStatus,
    ctx: AuditContext,
): Promise<ContactMessage> {
    const message = await repo.updateMessageStatus(id, status, ctx.userId,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'message',
        entityId: id,
        newValues: { status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return message;
}

export async function remove(id: string, ctx: AuditContext,): Promise<ContactMessage | null> {
    const existing = await getById(id,);
    if (!existing) return null;
    await repo.deleteMessage(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'message',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

// ─── Bulk ─────────────────────────────────────────────────────────

/** Unified bulk action ({ ids, action, value }) via performBulkAction. */
export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'contact_messages',
        allowedStatuses: ['unread', 'read', 'replied', 'archived', 'spam',],
        softDelete: false,
    },);
}

export async function bulkUpdateStatus(
    ids: string[],
    status: MessageStatus,
    ctx: AuditContext,
): Promise<void> {
    await repo.bulkUpdateStatus(ids, status,);
    await logAudit({
        userId: ctx.userId,
        action: 'bulk-update',
        entityType: 'message',
        newValues: { ids, status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export async function bulkRemove(ids: string[], ctx: AuditContext,): Promise<void> {
    await repo.bulkDelete(ids,);
    await logAudit({
        userId: ctx.userId,
        action: 'bulk-delete',
        entityType: 'message',
        newValues: { ids, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
