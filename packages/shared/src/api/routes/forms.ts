/**
 * Wire DTOs for the /forms module. Validation schemas live in
 * `packages/api/src/routes/forms.ts`.
 */

import type {
    Form,
    FormActionConfig,
    FormActionType,
    FormAnswer,
    FormQuestion,
    FormResults,
    FormStatus,
    FormSubmission,
    QuestionType,
    QuestionValidation,
    QuestionWidth,
} from '../../types/form';
import type { BulkActionResult, } from './_shared';

// ─── Question / form input shapes ─────────────────────────────────

/** A question as supplied on form create / add-question. On a form update the
 *  existing question's `id` is echoed back so the server can match rows. */
export interface FormQuestionInput {
    id?: string;
    type: QuestionType;
    question: string;
    description?: string | null;
    options?: string[];
    isRequired?: boolean;
    order?: number;
    validation?: QuestionValidation;
    width?: QuestionWidth;
    placeholder?: string;
    questionAsPlaceholder?: boolean;
    rows?: number;
    allowResize?: boolean;
    maxHeight?: string;
}

// ─── GET /forms ───────────────────────────────────────────────────

/** Query accepted by GET /forms. */
export interface FormListQuery {
    /** admin trigger: 'true' switches to the paginated all-statuses list */
    all?: string;
    /** admin filter (presence also triggers the admin list) */
    status?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number;
    limit?: number;
}

/**
 * GET /forms (PUBLIC shape) — a bare array of published forms, returned
 * when neither `all=true` nor `status` is present. No pagination meta.
 */
export type FormPublicListResponse = Form[];

/**
 * GET /forms (ADMIN shape) — list items returned when an admin passes
 * `all=true` or `status`. Page meta rides the ApiResponse envelope.
 */
export type FormAdminListResponse = Form[];

// ─── GET /forms/slug/:slug ────────────────────────────────────────

/** Params for the slug-scoped public form routes. */
export interface FormBySlugParams {
    slug: string;
}

/** GET /forms/slug/:slug — the published form with questions. */
export type FormBySlugResponse = Form;

// ─── GET /forms/slug/:slug/results ────────────────────────────────

/** GET /forms/slug/:slug/results — aggregated public results. */
export type FormResultsResponse = FormResults;

// ─── POST /forms/slug/:slug/submit ────────────────────────────────

/** Body for POST /forms/slug/:slug/submit. */
export interface FormSubmitBody {
    answers: FormAnswer[];
    /** Per-render idempotency token — dedups accidental double-submits. */
    nonce?: string;
}

/**
 * POST /forms/slug/:slug/submit (201) — submission acknowledgement.
 * A duplicate submission (when multiple submissions are disallowed)
 * yields a 409 CONFLICT instead of this payload.
 */
export interface FormSubmitResponse {
    message: string;
}

// ─── GET /forms/:id/submissions/export ────────────────────────────

/** Params for the form-by-id family of routes. */
export interface FormIdParams {
    id: string;
}

/**
 * GET /forms/:id/submissions/export streams raw `text/csv` with a
 * `Content-Disposition` attachment header — it does NOT use the JSON
 * ApiResponse envelope. This marker type documents that the response body
 * is a CSV string, not a structured payload.
 */
export type FormSubmissionsExportResponse = string;

// ─── POST /forms/bulk ─────────────────────────────────────────────

/** Body for POST /forms/bulk (unified bulk runner). */
export interface FormBulkBody {
    ids: string[];
    action: 'delete' | 'status';
    /** status value when action='status' */
    value?: string;
}

/** POST /forms/bulk — count + action performed. */
export type FormBulkResponse = BulkActionResult;

// ─── GET /forms/:id (admin) ───────────────────────────────────────

/** GET /forms/:id — the form with questions (any status). */
export type FormByIdResponse = Form;

// ─── GET /forms/:id/submissions ───────────────────────────────────

/** Query accepted by GET /forms/:id/submissions. */
export interface FormSubmissionsQuery {
    page?: number;
    limit?: number;
}

/** GET /forms/:id/submissions — submission rows. Page meta on the
 *  envelope. */
export type FormSubmissionsResponse = FormSubmission[];

// ─── POST /forms ──────────────────────────────────────────────────

/** Body for POST /forms (create). */
export interface FormCreateBody {
    title: string;
    slug: string;
    description?: string;
    status?: FormStatus;
    showResults?: boolean;
    allowMultipleSubmissions?: boolean;
    requiresAuth?: boolean;
    successMessage?: string;
    submitButtonText?: string;
    action?: FormActionType;
    actionConfig?: FormActionConfig;
    maxSubmissions?: number | null;
    questions?: FormQuestionInput[];
}

/** POST /forms (201) — the created form. */
export type FormCreateResponse = Form;

// ─── PUT /forms/:id ───────────────────────────────────────────────

/** Body for PUT /forms/:id — partial create body. */
export type FormUpdateBody = Partial<FormCreateBody>;

/** PUT /forms/:id — the updated form. */
export type FormUpdateResponse = Form;

// ─── POST /forms/:id/questions ────────────────────────────────────

/** Body for POST /forms/:id/questions. */
export type FormQuestionCreateBody = FormQuestionInput;

/** POST /forms/:id/questions (201) — the created question. */
export type FormQuestionCreateResponse = FormQuestion;

// ─── PUT|DELETE /forms/:formId/questions/:questionId ──────────────

/** Params for the question-scoped routes. */
export interface FormQuestionParams {
    formId: string;
    questionId: string;
}

/** Body for PUT /forms/:formId/questions/:questionId — partial input. */
export type FormQuestionUpdateBody = Partial<FormQuestionInput>;

/** PUT /forms/:formId/questions/:questionId — the updated question. */
export type FormQuestionUpdateResponse = FormQuestion;

/** DELETE /forms/:formId/questions/:questionId — confirmation message. */
export interface FormQuestionDeleteResponse {
    message: string;
}

// ─── DELETE /forms/:id ────────────────────────────────────────────

/** DELETE /forms/:id — confirmation message. */
export interface FormDeleteResponse {
    message: string;
}
