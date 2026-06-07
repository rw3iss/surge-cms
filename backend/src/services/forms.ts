/**
 * Forms service — form/survey/poll builder + submissions (headless spec).
 *
 * Wraps `repositories/forms.repo`: admin form CRUD + question CRUD,
 * public published listing, slug fetch with auth gating, submission with
 * duplicate-submission + required-field checks, results aggregation, CSV
 * export data, and bulk actions. Owns form cache invalidation. No prior
 * sdk module existed; this is the canonical service. `cms.forms` would
 * re-export it if added to the aggregate.
 *
 * Caching note: the published-forms list and the slug cache are public
 * data — published-only (and the slug cache is only populated for forms
 * that do NOT require auth). No admin shaping touches these caches.
 */
import type { Form, FormQuestion, FormSubmission, } from '@rw/cms-shared';
import { ValidationError, } from '../core/errors';
import * as repo from '../repositories/forms.repo';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
import { logAudit, } from './audit';
import { cache, } from './cache';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { FormFilters, } from '../repositories/forms.repo';

// ─── Admin reads ──────────────────────────────────────────────────

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

export async function getById(id: string,): Promise<Form | null> {
    try {
        const form = await repo.findFormById(id,);
        form.questions = await repo.findQuestionsByFormId(form.id,);
        return form;
    } catch {
        return null;
    }
}

// ─── Public reads (published-only — anonymous caching safe) ─────────

export async function listPublishedCached(): Promise<Form[]> {
    const cacheKey = 'forms:public';
    const cached = await cache.get<Form[]>(cacheKey,);
    if (cached) return cached;

    const forms = await repo.findPublishedForms();
    await cache.set(cacheKey, forms, 300,);
    return forms;
}

// SDK-surface reads (uncached) kept for `cms.forms` parity.
export async function listPublished(): Promise<Form[]> {
    return repo.findPublishedForms();
}

export async function getBySlug(slug: string,): Promise<Form | null> {
    return repo.findFormBySlug(slug,);
}

export async function getBySlugPublished(slug: string,): Promise<Form | null> {
    return repo.findFormBySlugPublished(slug,);
}

export async function listQuestions(formId: string,): Promise<FormQuestion[]> {
    return repo.findQuestionsByFormId(formId,);
}

/**
 * Public slug fetch with questions. Returns null when missing.
 * Enforces `requiresAuth` (caller passes whether a user is present).
 * Forms that don't require auth are cached for 300s.
 */
export async function getPublicBySlug(
    slug: string,
    hasUser: boolean,
): Promise<{ form: Form; } | { error: 'not_found' | 'unauthorized'; }> {
    const cacheKey = `form:slug:${slug}`;
    const cached = await cache.get<Form>(cacheKey,);
    if (cached && !cached.requiresAuth) return { form: cached, };

    const form = await repo.findFormBySlug(slug,);
    if (!form) return { error: 'not_found', };

    if (form.requiresAuth && !hasUser) return { error: 'unauthorized', };

    form.questions = await repo.findQuestionsByFormId(form.id,);

    if (!form.requiresAuth) {
        await cache.set(cacheKey, form, 300,);
    }
    return { form, };
}

// ─── Results aggregation ──────────────────────────────────────────

export interface FormResults {
    formId: string;
    totalSubmissions: number;
    questionResults: unknown[];
}

export async function getResultsBySlug(slug: string,): Promise<FormResults | null> {
    const form = await repo.findFormBySlugWithResults(slug,);
    if (!form) return null;

    const questions = await repo.findQuestionsByFormId(form.id,);
    const submissionRows = await repo.findSubmissionAnswers(form.id,);

    const questionResults = questions.map((q,) => {
        const answers = submissionRows
            .map((row,) => {
                const ans = (row.answers as Array<{ questionId: string; value: unknown; }>)
                    .find((a,) => a.questionId === q.id);
                return ans?.value;
            },)
            .filter((v,) => v !== undefined);

        let summary;

        if (['radio', 'checkbox', 'select',].includes(q.type,) && q.options) {
            const counts: Record<string, number> = {};
            q.options.forEach((opt,) => { counts[opt] = 0; },);

            answers.forEach((ans,) => {
                if (Array.isArray(ans,)) {
                    ans.forEach((a,) => {
                        if (counts[a] !== undefined) counts[a]++;
                    },);
                } else if (typeof ans === 'string' && counts[ans] !== undefined) {
                    counts[ans]++;
                }
            },);

            const total = Object.values(counts,).reduce((a, b,) => a + b, 0,);
            summary = {
                type: 'choice' as const,
                options: Object.entries(counts,).map(([value, count,],) => ({
                    value,
                    count,
                    percentage: total > 0 ? (count / total) * 100 : 0,
                })),
            };
        } else if (q.type === 'number') {
            const nums = answers.filter((a,): a is number => typeof a === 'number');
            if (nums.length > 0) {
                const sorted = [...nums,].sort((a, b,) => a - b);
                summary = {
                    type: 'number' as const,
                    min: Math.min(...nums,),
                    max: Math.max(...nums,),
                    average: nums.reduce((a, b,) => a + b, 0,) / nums.length,
                    median: sorted[Math.floor(sorted.length / 2,)],
                };
            } else {
                summary = { type: 'number' as const, min: 0, max: 0, average: 0, median: 0, };
            }
        } else {
            const texts = answers.filter((a,): a is string => typeof a === 'string');
            summary = {
                type: 'text' as const,
                sampleResponses: texts.slice(0, 5,),
                totalResponses: texts.length,
            };
        }

        return {
            questionId: q.id,
            question: q.question,
            type: q.type,
            responses: answers.length,
            summary,
        };
    },);

    return { formId: form.id, totalSubmissions: form.submissionCount, questionResults, };
}

// ─── Submission ───────────────────────────────────────────────────

export interface SubmitInput {
    slug: string;
    answers: Array<{ questionId: string; value: unknown; }>;
    userId: string | null;
    hasUser: boolean;
    ipAddress: string;
    userAgent?: string;
}

export type SubmitResult =
    | { ok: true; message: string; }
    | { error: 'not_found' | 'unauthorized' | 'duplicate'; };

export async function submit(input: SubmitInput,): Promise<SubmitResult> {
    const form = await repo.findFormBySlugPublished(input.slug,);
    if (!form) return { error: 'not_found', };

    if (form.requiresAuth && !input.hasUser) return { error: 'unauthorized', };

    if (!form.allowMultipleSubmissions) {
        const isDuplicate = await repo.checkDuplicateSubmission(
            form.id,
            input.userId,
            input.ipAddress,
        );
        if (isDuplicate) return { error: 'duplicate', };
    }

    // Validate required fields. Throws ValidationError → central error map.
    const questions = await repo.findQuestionsByFormId(form.id,);
    const requiredQuestions = questions.filter((q,) => q.isRequired);
    for (const rq of requiredQuestions) {
        const answer = input.answers.find((a,) => a.questionId === rq.id);
        if (!answer || answer.value === '' || (Array.isArray(answer.value,) && answer.value.length === 0)) {
            throw new ValidationError(`Question "${rq.question}" is required`,);
        }
    }

    await repo.createSubmission(form.id, input.userId, input.ipAddress, input.userAgent, input.answers,);
    await cache.invalidateFormCache(form.id,);

    return { ok: true, message: form.successMessage || 'Form submitted successfully', };
}

// ─── Submissions + CSV export ─────────────────────────────────────

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

function escapeCSV(value: string,): string {
    if (value.includes(',',) || value.includes('"',) || value.includes('\n',)) {
        return `"${value.replace(/"/g, '""',)}"`;
    }
    return value;
}

function toCSV(headers: string[], rows: string[][],): string {
    const headerLine = headers.map(escapeCSV,).join(',',);
    const dataLines = rows.map((row,) => row.map(escapeCSV,).join(',',));
    return [headerLine, ...dataLines,].join('\n',);
}

/** Build the CSV body + download filename for a form's submissions. */
export async function exportSubmissionsCsv(
    formId: string,
): Promise<{ csv: string; filename: string; }> {
    const form = await repo.findFormById(formId,);
    const questions = await repo.findQuestionsByFormId(formId,);
    const result = await repo.findSubmissions(formId, { page: 1, limit: 100000, },);
    const submissions = result.data;

    const headers = ['Submission ID', 'Submitted At', 'User ID', ...questions.map((q,) => q.question),];

    const rows = submissions.map((submission,) => {
        const answers = (submission.answers || []) as Array<{ questionId: string; value: unknown; }>;
        const questionValues = questions.map((q,) => {
            const answer = answers.find((a,) => a.questionId === q.id);
            if (!answer) return '';
            if (Array.isArray(answer.value,)) return answer.value.join('; ',);
            return String(answer.value ?? '',);
        },);
        return [
            submission.id,
            submission.submittedAt ? new Date(submission.submittedAt,).toISOString() : '',
            submission.userId || '',
            ...questionValues,
        ];
    },);

    return {
        csv: toCSV(headers, rows,),
        filename: `form-${form.slug}-submissions.csv`,
    };
}

// ─── Form writes ──────────────────────────────────────────────────

export async function create(data: Record<string, unknown>, ctx: AuditContext,): Promise<Form> {
    const form = await repo.createForm(data, ctx.userId,);

    const questions = (data.questions as Array<Record<string, unknown>> | undefined) ?? [];
    if (questions.length > 0) {
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const question = await repo.createQuestion(form.id, { ...q, order: q.order ?? i, },);
            form.questions.push(question,);
        }
    }

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

export async function update(id: string, patch: Record<string, unknown>, ctx: AuditContext,): Promise<Form> {
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

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    await repo.deleteForm(id,);
    await cache.invalidateFormCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'form',
        entityId: id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

// ─── Question writes ──────────────────────────────────────────────

export async function addQuestion(
    formId: string,
    data: Record<string, unknown>,
    ctx?: AuditContext,
): Promise<FormQuestion> {
    const question = await repo.createQuestion(formId, data,);
    await cache.invalidateFormCache(formId,);
    if (ctx) {
        await logAudit({
            userId: ctx.userId,
            action: 'create',
            entityType: 'form-question',
            entityId: question.id,
            newValues: { formId, ...data, },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }
    return question;
}

/** Alias kept for `cms.forms` SDK parity. */
export const createQuestion = addQuestion;

export async function updateQuestion(
    formId: string,
    questionId: string,
    data: Record<string, unknown>,
    ctx?: AuditContext,
): Promise<FormQuestion> {
    const question = await repo.updateQuestion(formId, questionId, data,);
    await cache.invalidateFormCache(formId,);
    if (ctx) {
        await logAudit({
            userId: ctx.userId,
            action: 'update',
            entityType: 'form-question',
            entityId: questionId,
            newValues: data,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }
    return question;
}

export async function deleteQuestion(formId: string, questionId: string, ctx?: AuditContext,): Promise<void> {
    await repo.deleteQuestion(formId, questionId,);
    await cache.invalidateFormCache(formId,);
    if (ctx) {
        await logAudit({
            userId: ctx.userId,
            action: 'delete',
            entityType: 'form-question',
            entityId: questionId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }
}

/** Alias kept for `cms.forms` SDK parity. */
export const removeQuestion = deleteQuestion;

// ─── Bulk ─────────────────────────────────────────────────────────

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'forms',
        allowedStatuses: ['draft', 'published', 'closed', 'archived',],
        softDelete: false,
        onInvalidate: () => cache.invalidateFormCache(),
    },);
}
