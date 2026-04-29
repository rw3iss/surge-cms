/**
 * cms.messages — contact form inbox.
 *
 * Wraps `repositories/messages.repo`. Public side can submit messages
 * (`create`); admin side lists, reads, updates status, and deletes
 * via the Service contract.
 */
import type { ContactMessage, MessageStatus, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import * as repo from '../repositories/messages.repo';
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

export interface CreateMessageInput {
    name: string;
    email: string;
    subject?: string;
    message: string;
    /** Visitor user id, when authenticated. `null` for anonymous. */
    userId?: string | null;
    ipAddress: string;
    userAgent?: string;
}

/** Public message submission. The acting "user" is the visitor —
 *  audit context is optional since no admin acted. */
export async function create(input: CreateMessageInput,): Promise<ContactMessage> {
    return repo.createMessage(
        { name: input.name, email: input.email, subject: input.subject, message: input.message, },
        input.userId ?? null,
        input.ipAddress,
        input.userAgent,
    );
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
