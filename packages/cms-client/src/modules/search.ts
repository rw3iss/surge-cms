import type {
    SearchQuery, SearchResponse, AdminSearchQuery, AdminSearchResponse,
} from '@rw/cms-shared';
import { ModuleBase, } from './base';

/** /search namespace — grouped full-text search (keyed-map responses). */
export class SearchModule extends ModuleBase {
    protected readonly module = 'search';

    /** GET /search — public grouped hits ({ posts?, pages?, campaigns? }); total on the envelope. */
    query(q: string, query?: Omit<SearchQuery, 'q'>,): Promise<SearchResponse> {
        return this.get<SearchResponse>('/search', { query: { q, ...query, } as Record<string, unknown>, },);
    }

    /** GET /search/admin — grouped raw row projections across all content types, any status. */
    adminSearch(q: string, query?: Omit<AdminSearchQuery, 'q'>,): Promise<AdminSearchResponse> {
        return this.get<AdminSearchResponse>('/search/admin', { query: { q, ...query, } as Record<string, unknown>, },);
    }
}
