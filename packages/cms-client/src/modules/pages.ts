import type {
    PageNavigationResponse, PageHomepageResponse, PageBySlugQuery, PageBySlugResponse,
    PageListQuery, PageListResponse, PageByIdResponse, PageCreateBody, PageCreateResponse,
    PageUpdateBody, PageUpdateResponse, PageDeleteResponse, PageBulkBody, PageBulkResponse,
    PageRevisionListResponse, PageRevisionResponse, PageRevisionRestoreResponse,
    PageBlockBody, PageBlockCreateResponse, PageBlockUpdateBody, PageBlockUpdateResponse,
    PageBlockDeleteResponse, PageReorderBlocksBody, PageReorderBlocksResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /pages namespace — CMS pages with embedded blocks, revisions, block CRUD. */
export class PagesModule extends ModuleBase {
    protected readonly module = 'pages';

    /** GET /pages/navigation — published main-nav tree. */
    navigation(): Promise<PageNavigationResponse> {
        return this.get<PageNavigationResponse>('/pages/navigation',);
    }

    /** GET /pages/homepage — the page flagged as homepage. */
    homepage(): Promise<PageHomepageResponse> {
        return this.get<PageHomepageResponse>('/pages/homepage',);
    }

    /** GET /pages/slug/:slug — throws ContentLockedError on gated content. */
    getBySlug(slug: string, query?: PageBySlugQuery,): Promise<PageBySlugResponse> {
        return this.get<PageBySlugResponse>('/pages/slug/:slug', { params: { slug, }, query: query as Record<string, unknown>, },);
    }

    /** GET /pages (admin) — any status, paginated. */
    list(query?: PageListQuery,): Promise<Paginated<PageListResponse[number]>> {
        return this.getPaged<PageListResponse[number]>('/pages', { query: query as Record<string, unknown>, },);
    }

    /** GET /pages/:id (admin) — full page with blocks, any status. */
    getById(id: string,): Promise<PageByIdResponse> {
        return this.get<PageByIdResponse>('/pages/:id', { params: { id, }, },);
    }

    create(body: PageCreateBody,): Promise<PageCreateResponse> {
        return this.mutate<PageCreateResponse>('POST', '/pages', { body, invalidates: ['pages',], },);
    }

    update(id: string, body: PageUpdateBody,): Promise<PageUpdateResponse> {
        return this.mutate<PageUpdateResponse>('PUT', '/pages/:id', { params: { id, }, body, invalidates: ['pages',], },);
    }

    remove(id: string,): Promise<PageDeleteResponse> {
        return this.mutate<PageDeleteResponse>('DELETE', '/pages/:id', { params: { id, }, invalidates: ['pages',], },);
    }

    bulk(body: PageBulkBody,): Promise<PageBulkResponse> {
        return this.mutate<PageBulkResponse>('POST', '/pages/bulk', { body, invalidates: ['pages',], },);
    }

    // ─── Revisions ────────────────────────────────────────────────
    listRevisions(id: string,): Promise<PageRevisionListResponse> {
        return this.get<PageRevisionListResponse>('/pages/:id/revisions', { params: { id, }, },);
    }

    getRevision(id: string, version: number,): Promise<PageRevisionResponse> {
        return this.get<PageRevisionResponse>('/pages/:id/revisions/:version', { params: { id, version, }, },);
    }

    restoreRevision(id: string, version: number,): Promise<PageRevisionRestoreResponse> {
        return this.mutate<PageRevisionRestoreResponse>('POST', '/pages/:id/revisions/:version/restore', { params: { id, version, }, invalidates: ['pages',], },);
    }

    // ─── Block CRUD ───────────────────────────────────────────────
    createBlock(pageId: string, body: PageBlockBody,): Promise<PageBlockCreateResponse> {
        return this.mutate<PageBlockCreateResponse>('POST', '/pages/:pageId/blocks', { params: { pageId, }, body, invalidates: ['pages',], },);
    }

    updateBlock(pageId: string, blockId: string, body: PageBlockUpdateBody,): Promise<PageBlockUpdateResponse> {
        return this.mutate<PageBlockUpdateResponse>('PUT', '/pages/:pageId/blocks/:blockId', { params: { pageId, blockId, }, body, invalidates: ['pages',], },);
    }

    deleteBlock(pageId: string, blockId: string,): Promise<PageBlockDeleteResponse> {
        return this.mutate<PageBlockDeleteResponse>('DELETE', '/pages/:pageId/blocks/:blockId', { params: { pageId, blockId, }, invalidates: ['pages',], },);
    }

    reorderBlocks(pageId: string, body: PageReorderBlocksBody,): Promise<PageReorderBlocksResponse> {
        return this.mutate<PageReorderBlocksResponse>('PUT', '/pages/:pageId/blocks/reorder', { params: { pageId, }, body, invalidates: ['pages',], },);
    }
}
