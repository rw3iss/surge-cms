import type {
    FormListQuery, FormPublicListResponse, FormAdminListResponse, FormBySlugResponse,
    FormResultsResponse, FormSubmitBody, FormSubmitResponse, FormByIdResponse,
    FormSubmissionsQuery, FormSubmissionsResponse, FormCreateBody, FormCreateResponse,
    FormUpdateBody, FormUpdateResponse, FormDeleteResponse, FormBulkBody, FormBulkResponse,
    FormQuestionCreateBody, FormQuestionCreateResponse, FormQuestionUpdateBody,
    FormQuestionUpdateResponse, FormQuestionDeleteResponse, FormSubmissionsExportResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /forms namespace — public list/submit + admin CRUD, questions, CSV export. */
export class FormsModule extends ModuleBase {
    protected readonly module = 'forms';

    /** GET /forms — public bare array of published forms. */
    listPublic(query?: FormListQuery,): Promise<FormPublicListResponse> {
        return this.get<FormPublicListResponse>('/forms', { query: query as Record<string, unknown>, },);
    }

    /** GET /forms (admin) — passes all=true to switch to the paginated all-statuses list. */
    list(query?: FormListQuery,): Promise<Paginated<FormAdminListResponse[number]>> {
        return this.getPaged<FormAdminListResponse[number]>('/forms', { query: { all: true, ...(query as Record<string, unknown>), }, },);
    }

    /** GET /forms/slug/:slug — published form with questions. */
    getBySlug(slug: string,): Promise<FormBySlugResponse> {
        return this.get<FormBySlugResponse>('/forms/slug/:slug', { params: { slug, }, },);
    }

    /** GET /forms/slug/:slug/results — aggregated public results. */
    results(slug: string,): Promise<FormResultsResponse> {
        return this.get<FormResultsResponse>('/forms/slug/:slug/results', { params: { slug, }, },);
    }

    /** POST /forms/slug/:slug/submit — public submission (enforces auth/dups server-side). */
    submit(slug: string, body: FormSubmitBody,): Promise<FormSubmitResponse> {
        return this.mutate<FormSubmitResponse>('POST', '/forms/slug/:slug/submit', { params: { slug, }, body, invalidates: ['forms',], },);
    }

    /** GET /forms/:id (admin) — form with questions, any status. */
    getById(id: string,): Promise<FormByIdResponse> {
        return this.get<FormByIdResponse>('/forms/:id', { params: { id, }, },);
    }

    /** GET /forms/:id/submissions (admin) — submission rows, paginated. */
    listSubmissions(id: string, query?: FormSubmissionsQuery,): Promise<Paginated<FormSubmissionsResponse[number]>> {
        return this.getPaged<FormSubmissionsResponse[number]>('/forms/:id/submissions', { params: { id, }, query: query as Record<string, unknown>, },);
    }

    /**
     * GET /forms/:id/submissions/export — raw CSV string (NOT the JSON
     * envelope). Mounted under /api/v1, so rootMounted stays false. `rawGet`
     * does not interpolate params, so build the path explicitly.
     */
    exportSubmissions(id: string,): Promise<FormSubmissionsExportResponse> {
        return this.rawGet(`/forms/${encodeURIComponent(id,)}/submissions/export`,);
    }

    create(body: FormCreateBody,): Promise<FormCreateResponse> {
        return this.mutate<FormCreateResponse>('POST', '/forms', { body, invalidates: ['forms',], },);
    }

    update(id: string, body: FormUpdateBody,): Promise<FormUpdateResponse> {
        return this.mutate<FormUpdateResponse>('PUT', '/forms/:id', { params: { id, }, body, invalidates: ['forms',], },);
    }

    remove(id: string,): Promise<FormDeleteResponse> {
        return this.mutate<FormDeleteResponse>('DELETE', '/forms/:id', { params: { id, }, invalidates: ['forms',], },);
    }

    bulk(body: FormBulkBody,): Promise<FormBulkResponse> {
        return this.mutate<FormBulkResponse>('POST', '/forms/bulk', { body, invalidates: ['forms',], },);
    }

    // ─── Questions ────────────────────────────────────────────────
    createQuestion(id: string, body: FormQuestionCreateBody,): Promise<FormQuestionCreateResponse> {
        return this.mutate<FormQuestionCreateResponse>('POST', '/forms/:id/questions', { params: { id, }, body, invalidates: ['forms',], },);
    }

    updateQuestion(formId: string, questionId: string, body: FormQuestionUpdateBody,): Promise<FormQuestionUpdateResponse> {
        return this.mutate<FormQuestionUpdateResponse>('PUT', '/forms/:formId/questions/:questionId', { params: { formId, questionId, }, body, invalidates: ['forms',], },);
    }

    deleteQuestion(formId: string, questionId: string,): Promise<FormQuestionDeleteResponse> {
        return this.mutate<FormQuestionDeleteResponse>('DELETE', '/forms/:formId/questions/:questionId', { params: { formId, questionId, }, invalidates: ['forms',], },);
    }
}
