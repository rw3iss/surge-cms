import type { Form, FormQuestion, FormSubmission, } from '@sitesurge/types';
import { query, transaction, } from '../db';
import { NotFoundError, ValidationError, } from '../middleware/error';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';
import { deleteById, findByIdOrThrow, paginatedQuery, PaginatedResult, PaginationOptions, } from './base.repo';

// ─── Forms ───

export interface FormFilters {
    status?: string;
    sortBy?: string;
    sortOrder?: string;
}

const FORM_SORT_COLUMNS: Record<string, string> = {
    title: 'title',
    status: 'status',
    created_at: 'created_at',
    updated_at: 'updated_at',
    submission_count: 'submission_count',
};

export async function findPublishedForms(): Promise<Form[]> {
    const result = await query(
        `SELECT * FROM forms WHERE status = 'published' ORDER BY created_at DESC`,
    );
    return mapRows<Form>(result.rows,);
}

export async function findFormBySlug(slug: string,): Promise<Form | null> {
    const result = await query(
        `SELECT * FROM forms WHERE slug = $1 AND status = 'published'`,
        [slug,],
    );
    return result.rows.length > 0 ? mapRow<Form>(result.rows[0],) : null;
}

export async function findFormBySlugWithResults(slug: string,): Promise<Form | null> {
    const result = await query(
        `SELECT * FROM forms WHERE slug = $1 AND status IN ('published', 'closed') AND show_results = true`,
        [slug,],
    );
    return result.rows.length > 0 ? mapRow<Form>(result.rows[0],) : null;
}

export async function findFormBySlugPublished(slug: string,): Promise<Form | null> {
    const result = await query(
        `SELECT * FROM forms WHERE slug = $1 AND status = 'published'`,
        [slug,],
    );
    return result.rows.length > 0 ? mapRow<Form>(result.rows[0],) : null;
}

export async function findForms(
    filters: FormFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<Form>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }

    const col = FORM_SORT_COLUMNS[filters.sortBy || 'updated_at'] || 'updated_at';
    const dir = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';

    return paginatedQuery<Form>(
        `SELECT * FROM forms ${whereClause} ORDER BY ${col} ${dir}`,
        `SELECT COUNT(*) FROM forms ${whereClause}`,
        params,
        pagination,
    );
}

export async function findFormById(id: string,): Promise<Form> {
    return findByIdOrThrow<Form>('forms', id, 'Form',);
}

export async function createForm(data: Record<string, unknown>, userId: string,): Promise<Form> {
    const result = await query(
        `INSERT INTO forms (title, slug, description, status, show_results,
                        allow_multiple_submissions, requires_auth, success_message,
                        submit_button_text, action, action_config, max_submissions, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
        [
            data.title,
            data.slug,
            data.description,
            data.status || 'draft',
            data.showResults ?? false,
            data.allowMultipleSubmissions ?? false,
            data.requiresAuth ?? false,
            data.successMessage,
            (data.submitButtonText as string | undefined) || null,
            data.action || 'submit',
            JSON.stringify(data.actionConfig ?? {},),
            (data.maxSubmissions as number | null | undefined) ?? null,
            // created_by is a UUID FK; synthetic actors (api-key:<name>,
            // system) become NULL.
            uuidOrNull(userId,),
        ],
    );

    const form = mapRow<Form>(result.rows[0],);
    form.questions = [];
    return form;
}

export async function updateForm(id: string, data: Record<string, unknown>,): Promise<Form> {
    // Verify exists
    await findByIdOrThrow('forms', id, 'Form',);

    const updates: string[] = [];
    const values: unknown[] = [];

    const fields: Record<string, string> = {
        title: 'title',
        slug: 'slug',
        description: 'description',
        status: 'status',
        showResults: 'show_results',
        allowMultipleSubmissions: 'allow_multiple_submissions',
        requiresAuth: 'requires_auth',
        successMessage: 'success_message',
        submitButtonText: 'submit_button_text',
        action: 'action',
        maxSubmissions: 'max_submissions',
    };

    for (const [key, dbCol,] of Object.entries(fields,)) {
        if (data[key] !== undefined) {
            values.push(data[key],);
            updates.push(`${dbCol} = $${values.length}`,);
        }
    }

    // action_config is JSONB — serialize explicitly.
    if (data.actionConfig !== undefined) {
        values.push(JSON.stringify(data.actionConfig,),);
        updates.push(`action_config = $${values.length}`,);
    }

    if (data.status === 'closed') {
        values.push(new Date().toISOString(),);
        updates.push(`closed_at = $${values.length}`,);
    }

    if (updates.length > 0) {
        values.push(id,);
        await query(
            `UPDATE forms SET ${updates.join(', ',)}, updated_at = NOW() WHERE id = $${values.length}`,
            values,
        );
    }

    // Fetch updated form with questions
    const form = await findByIdOrThrow<Form>('forms', id, 'Form',);
    form.questions = await findQuestionsByFormId(id,);
    return form;
}

export async function deleteForm(id: string,): Promise<void> {
    return deleteById('forms', id, 'Form',);
}

// ─── Questions ───

export async function findQuestionsByFormId(formId: string,): Promise<FormQuestion[]> {
    const result = await query(
        `SELECT * FROM form_questions WHERE form_id = $1 ORDER BY "order" ASC`,
        [formId,],
    );
    return mapRows<FormQuestion>(result.rows,);
}

export async function createQuestion(formId: string, data: Record<string, unknown>,): Promise<FormQuestion> {
    await findByIdOrThrow('forms', formId, 'Form',);

    const maxOrder = await query(
        'SELECT COALESCE(MAX("order"), -1) + 1 as next_order FROM form_questions WHERE form_id = $1',
        [formId,],
    );

    const result = await query(
        `INSERT INTO form_questions (form_id, type, question, description, options,
                                 is_required, "order", validation, width,
                                 placeholder, question_as_placeholder, "rows", allow_resize, max_height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
        [
            formId,
            data.type,
            data.question,
            data.description,
            data.options || null,
            data.isRequired ?? false,
            data.order ?? maxOrder.rows[0].next_order,
            data.validation ? JSON.stringify(data.validation,) : null,
            data.width ?? 'full',
            (data.placeholder as string | undefined) || null,
            data.questionAsPlaceholder ?? false,
            (data.rows as number | undefined) ?? null,
            data.allowResize ?? true,
            (data.maxHeight as string | undefined) || null,
        ],
    );

    return mapRow<FormQuestion>(result.rows[0],);
}

export async function updateQuestion(
    formId: string,
    questionId: string,
    data: Record<string, unknown>,
): Promise<FormQuestion> {
    const updates: string[] = [];
    const values: unknown[] = [];

    const fieldMap: Record<string, string> = {
        type: 'type',
        question: 'question',
        description: 'description',
        options: 'options',
        isRequired: 'is_required',
        order: '"order"',
        width: 'width',
        placeholder: 'placeholder',
        questionAsPlaceholder: 'question_as_placeholder',
        rows: '"rows"',
        allowResize: 'allow_resize',
        maxHeight: 'max_height',
    };

    for (const [key, dbCol,] of Object.entries(fieldMap,)) {
        if (data[key] !== undefined) {
            values.push(data[key],);
            updates.push(`${dbCol} = $${values.length}`,);
        }
    }

    if (data.validation !== undefined) {
        values.push(JSON.stringify(data.validation,),);
        updates.push(`validation = $${values.length}`,);
    }

    if (updates.length === 0) {
        throw new ValidationError('No fields to update',);
    }

    values.push(questionId, formId,);
    const result = await query(
        `UPDATE form_questions SET ${updates.join(', ',)}, updated_at = NOW()
     WHERE id = $${values.length - 1} AND form_id = $${values.length}
     RETURNING *`,
        values,
    );

    if (result.rows.length === 0) {
        throw new NotFoundError('Question',);
    }

    return mapRow<FormQuestion>(result.rows[0],);
}

export async function deleteQuestion(formId: string, questionId: string,): Promise<void> {
    const result = await query(
        'DELETE FROM form_questions WHERE id = $1 AND form_id = $2 RETURNING id',
        [questionId, formId,],
    );
    if (result.rows.length === 0) {
        throw new NotFoundError('Question',);
    }
}

/**
 * Reconcile a form's questions against the editor's submitted list in ONE
 * transaction: update existing rows (matched by id), insert new ones (no id),
 * and delete any that were removed — all-or-nothing so a mid-save failure can't
 * leave the form with a half-applied question set. Order is the array position.
 * Returns the fresh list.
 */
export async function syncQuestions(
    formId: string,
    incoming: Array<Record<string, unknown>>,
): Promise<FormQuestion[]> {
    await findByIdOrThrow('forms', formId, 'Form',);
    return transaction(async (client,) => {
        const existing = await client.query<{ id: string; }>(
            'SELECT id FROM form_questions WHERE form_id = $1',
            [formId,],
        );
        const existingIds = new Set(existing.rows.map((r,) => r.id),);
        const kept: string[] = [];

        for (let i = 0; i < incoming.length; i++) {
            const raw = incoming[i];
            const qid = raw.id as string | undefined;
            const order = (raw.order as number | undefined) ?? i;
            const options = (raw.options as string[] | undefined) ?? null;
            const validation = raw.validation ? JSON.stringify(raw.validation,) : null;
            const width = (raw.width as string | undefined) ?? 'full';
            const placeholder = (raw.placeholder as string | undefined) || null;
            const questionAsPlaceholder = (raw.questionAsPlaceholder as boolean | undefined) ?? false;
            const rows = (raw.rows as number | undefined) ?? null;
            const allowResize = (raw.allowResize as boolean | undefined) ?? true;
            const maxHeight = (raw.maxHeight as string | undefined) || null;

            if (qid && existingIds.has(qid,)) {
                await client.query(
                    `UPDATE form_questions
                     SET type = $1, question = $2, description = $3, options = $4,
                         is_required = $5, "order" = $6, validation = $7, width = $8,
                         placeholder = $9, question_as_placeholder = $10, "rows" = $11,
                         allow_resize = $12, max_height = $13, updated_at = NOW()
                     WHERE id = $14 AND form_id = $15`,
                    [raw.type, raw.question, raw.description ?? null, options,
                        raw.isRequired ?? false, order, validation, width,
                        placeholder, questionAsPlaceholder, rows, allowResize, maxHeight, qid, formId,],
                );
                kept.push(qid,);
            } else {
                const ins = await client.query<{ id: string; }>(
                    `INSERT INTO form_questions (form_id, type, question, description, options,
                                                 is_required, "order", validation, width,
                                                 placeholder, question_as_placeholder, "rows", allow_resize, max_height)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                     RETURNING id`,
                    [formId, raw.type, raw.question, raw.description ?? null, options,
                        raw.isRequired ?? false, order, validation, width,
                        placeholder, questionAsPlaceholder, rows, allowResize, maxHeight,],
                );
                kept.push(ins.rows[0].id,);
            }
        }

        // Drop any questions the editor removed.
        if (kept.length > 0) {
            await client.query(
                `DELETE FROM form_questions WHERE form_id = $1 AND id <> ALL($2::uuid[])`,
                [formId, kept,],
            );
        } else {
            await client.query('DELETE FROM form_questions WHERE form_id = $1', [formId,],);
        }

        const fresh = await client.query(
            'SELECT * FROM form_questions WHERE form_id = $1 ORDER BY "order" ASC',
            [formId,],
        );
        return mapRows<FormQuestion>(fresh.rows,);
    },);
}

// ─── Submissions ───

export async function findSubmissions(
    formId: string,
    pagination: PaginationOptions,
): Promise<PaginatedResult<FormSubmission>> {
    const offset = (pagination.page - 1) * pagination.limit;

    const countResult = await query(
        `SELECT COUNT(*) FROM form_submissions WHERE form_id = $1`,
        [formId,],
    );
    const total = parseInt(countResult.rows[0].count, 10,);

    const result = await query(
        `SELECT fs.*, u.display_name as user_name, u.email as user_email
     FROM form_submissions fs
     LEFT JOIN users u ON fs.user_id = u.id
     WHERE fs.form_id = $1
     ORDER BY fs.submitted_at DESC
     LIMIT $2 OFFSET $3`,
        [formId, pagination.limit, offset,],
    );

    return {
        data: mapRows<FormSubmission>(result.rows,),
        total,
    };
}

export async function findSubmissionAnswers(formId: string,): Promise<Record<string, unknown>[]> {
    const result = await query(
        `SELECT answers FROM form_submissions WHERE form_id = $1`,
        [formId,],
    );
    return result.rows;
}

export async function checkDuplicateSubmission(
    formId: string,
    userId: string | null,
    ipAddress: string,
): Promise<boolean> {
    const existing = await query(
        `SELECT id FROM form_submissions WHERE form_id = $1 AND (user_id = $2 OR ip_address = $3)`,
        // user_id is a UUID column; an api-key/synthetic actor can't match a
        // real submitter, so coerce to NULL (the OR ip_address branch still
        // applies) rather than letting Postgres reject the invalid UUID.
        [formId, uuidOrNull(userId,), ipAddress,],
    );
    return existing.rows.length > 0;
}

/**
 * Insert a submission. Returns `true` when a row was inserted, `false` when the
 * (form_id, nonce) already existed — the `ON CONFLICT … DO NOTHING` makes a
 * repeated submit from the same form render idempotent (accidental double-click
 * / resubmit). A null nonce never conflicts (partial index excludes it).
 */
export async function createSubmission(
    formId: string,
    userId: string | null,
    ipAddress: string,
    userAgent: string | undefined,
    answers: unknown,
    nonce: string | null = null,
): Promise<boolean> {
    const result = await query(
        `INSERT INTO form_submissions (form_id, user_id, ip_address, user_agent, answers, nonce)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (form_id, nonce) WHERE nonce IS NOT NULL DO NOTHING
     RETURNING id`,
        // user_id is a UUID FK; an api-key/synthetic submitter becomes NULL.
        [formId, uuidOrNull(userId,), ipAddress, userAgent, JSON.stringify(answers,), nonce,],
    );
    return result.rows.length > 0;
}
