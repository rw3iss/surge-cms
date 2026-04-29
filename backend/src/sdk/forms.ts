/**
 * cms.forms — surveys / forms / poll builder.
 *
 * Wraps `repositories/forms.repo` with the SDK contract: form CRUD,
 * question accessors, submission listing. Handles cache + audit
 * around writes; submission accessors are read-only.
 */
import type { Form, FormQuestion, FormSubmission, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import * as repo from '../repositories/forms.repo';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { FormFilters, } from '../repositories/forms.repo';

// ─── Reads ────────────────────────────────────────────────────────

export async function list(
    filters: repo.FormFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Form>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findForms(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function listPublished(): Promise<Form[]> {
    return repo.findPublishedForms();
}

export async function getById(id: string,): Promise<Form | null> {
    try {
        return await repo.findFormById(id,);
    } catch {
        return null;
    }
}

export async function getBySlug(slug: string,): Promise<Form | null> {
    return repo.findFormBySlug(slug,);
}

export async function getBySlugPublished(slug: string,): Promise<Form | null> {
    return repo.findFormBySlugPublished(slug,);
}

// ─── Writes ───────────────────────────────────────────────────────

export async function create(
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Form> {
    const form = await repo.createForm(data, ctx.userId,);
    await cache.invalidateFormCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'form',
        entityId: form.id,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return form;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Form> {
    const form = await repo.updateForm(id, patch,);
    await cache.invalidateFormCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'form',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return form;
}

export async function remove(id: string, ctx: AuditContext,): Promise<Form | null> {
    const existing = await getById(id,);
    if (!existing) return null;
    await repo.deleteForm(id,);
    await cache.invalidateFormCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'form',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

// ─── Questions ────────────────────────────────────────────────────

export async function listQuestions(formId: string,): Promise<FormQuestion[]> {
    return repo.findQuestionsByFormId(formId,);
}

export async function createQuestion(
    formId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<FormQuestion> {
    const q = await repo.createQuestion(formId, data,);
    await cache.invalidateFormCache(formId,);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'form-question',
        entityId: q.id,
        newValues: { formId, ...data, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return q;
}

export async function updateQuestion(
    formId: string,
    questionId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<FormQuestion> {
    const q = await repo.updateQuestion(formId, questionId, data,);
    await cache.invalidateFormCache(formId,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'form-question',
        entityId: questionId,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return q;
}

export async function removeQuestion(
    formId: string,
    questionId: string,
    ctx: AuditContext,
): Promise<void> {
    await repo.deleteQuestion(formId, questionId,);
    await cache.invalidateFormCache(formId,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'form-question',
        entityId: questionId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

// ─── Submissions ──────────────────────────────────────────────────

export async function listSubmissions(
    formId: string,
    pagination: PaginationOpts = {},
): Promise<ListResult<FormSubmission>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 50;
    const result = await repo.findSubmissions(formId, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}
