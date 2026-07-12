import type {
    MailTemplateVariablesResponse, MailTemplateListResponse, MailTemplateGetResponse,
    MailTemplateCreateBody, MailTemplateCreateResponse, MailTemplateUpdateBody, MailTemplateUpdateResponse,
    MailTemplatePreviewBody, MailTemplatePreviewResponse, MailTemplateBlocksReplaceBody,
    MailTemplateBlocksReplaceResponse, MailTemplateDeleteResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * mailTemplates namespace (all admin) — block-editor-backed email
 * templates. Meta-only list/CRUD; full block tree on getById; preview
 * renders HTML and detects `{{tokens}}`; replaceBlocks does a
 * transactional block-tree replace.
 */
export class MailTemplatesModule extends ModuleBase {
    protected readonly module = 'mailTemplates';

    /** GET /mail-templates — meta only (no blocks). */
    list(): Promise<MailTemplateListResponse> {
        return this.get<MailTemplateListResponse>('/mail-templates',);
    }

    /** GET /mail-templates/:id — meta + full block tree. */
    getById(id: string,): Promise<MailTemplateGetResponse> {
        return this.get<MailTemplateGetResponse>('/mail-templates/:id', { params: { id, }, },);
    }

    /** GET /mail-templates/variables — token catalog for the reference UI. */
    variables(): Promise<MailTemplateVariablesResponse> {
        return this.get<MailTemplateVariablesResponse>('/mail-templates/variables',);
    }

    /** POST /mail-templates — create (meta only). */
    create(body: MailTemplateCreateBody,): Promise<MailTemplateCreateResponse> {
        return this.mutate<MailTemplateCreateResponse>('POST', '/mail-templates', { body, invalidates: ['mailTemplates',], },);
    }

    /** PUT /mail-templates/:id — update meta. */
    update(id: string, body: MailTemplateUpdateBody,): Promise<MailTemplateUpdateResponse> {
        return this.mutate<MailTemplateUpdateResponse>('PUT', '/mail-templates/:id', { params: { id, }, body, invalidates: ['mailTemplates',], },);
    }

    /** DELETE /mail-templates/:id. */
    remove(id: string,): Promise<MailTemplateDeleteResponse> {
        return this.mutate<MailTemplateDeleteResponse>('DELETE', '/mail-templates/:id', { params: { id, }, invalidates: ['mailTemplates',], },);
    }

    /** POST /mail-templates/preview — render HTML + detect tokens (idempotent). */
    preview(body: MailTemplatePreviewBody,): Promise<MailTemplatePreviewResponse> {
        return this.mutate<MailTemplatePreviewResponse>('POST', '/mail-templates/preview', { body, },);
    }

    /** PUT /mail-templates/:id/blocks — transactional block-tree replace. */
    replaceBlocks(id: string, body: MailTemplateBlocksReplaceBody,): Promise<MailTemplateBlocksReplaceResponse> {
        return this.mutate<MailTemplateBlocksReplaceResponse>('PUT', '/mail-templates/:id/blocks', { params: { id, }, body, invalidates: ['mailTemplates',], },);
    }
}
