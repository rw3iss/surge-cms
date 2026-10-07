import type {
    MailTemplateVariablesResponse, MailTemplateListResponse, MailTemplateOptionsResponse, MailTemplateGetResponse,
    MailTemplateCreateBody, MailTemplateCreateResponse, MailTemplateUpdateBody, MailTemplateUpdateResponse,
    MailTemplatePreviewBody, MailTemplatePreviewResponse, MailTemplateBlocksReplaceBody,
    MailTemplateBlocksReplaceResponse, MailTemplateDeleteResponse, MailTemplateCopyResponse,
    PageRevisionListResponse, Revision, RevisionRestoreOutcome, RevisionSnapshotResponse,
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

    /** GET /mail-templates/options — enabled templates by name (staff; needs the
     *  Mailing Lists feature). The list behind any template picker. */
    options(): Promise<MailTemplateOptionsResponse> {
        return this.get<MailTemplateOptionsResponse>('/mail-templates/options',);
    }

    /** GET /mail-templates/:id/revisions — saved versions (meta + whole block tree each). */
    revisions(id: string,): Promise<PageRevisionListResponse> {
        return this.get<PageRevisionListResponse>('/mail-templates/:id/revisions', { params: { id, }, options: { cache: false, }, },);
    }

    /** POST /mail-templates/:id/revisions — snapshot the current state now. */
    snapshotRevision(id: string,): Promise<RevisionSnapshotResponse> {
        return this.mutate<RevisionSnapshotResponse>('POST', '/mail-templates/:id/revisions', { params: { id, }, },);
    }

    /** GET /mail-templates/:id/revisions/:version — one snapshot. */
    getRevision(id: string, version: number,): Promise<Revision> {
        return this.get<Revision>('/mail-templates/:id/revisions/:version', { params: { id, version, }, options: { cache: false, }, },);
    }

    /** POST /mail-templates/:id/revisions/:version/restore — settings + whole block tree. */
    restoreRevision(id: string, version: number,): Promise<MailTemplateGetResponse & { restore: RevisionRestoreOutcome; }> {
        return this.mutate<MailTemplateGetResponse & { restore: RevisionRestoreOutcome; }>('POST', '/mail-templates/:id/revisions/:version/restore', { params: { id, version, }, invalidates: ['mailTemplates',], },);
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

    /** POST /mail-templates/:id/copy — clone a template (meta + blocks). */
    copy(id: string,): Promise<MailTemplateCopyResponse> {
        return this.mutate<MailTemplateCopyResponse>('POST', '/mail-templates/:id/copy', { params: { id, }, invalidates: ['mailTemplates',], },);
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
