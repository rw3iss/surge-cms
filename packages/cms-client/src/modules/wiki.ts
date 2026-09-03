import type { WikiDeleteMode, WikiPage, WikiSearchHit, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/** /wiki — markdown pages in a tree, with search. 404s when the feature is off. */
export class WikiModule extends ModuleBase {
    protected readonly module = 'wiki';

    /** Flat list the caller may view; build the tree with buildWikiTree(). */
    list(all = false,): Promise<WikiPage[]> {
        return this.get<WikiPage[]>('/wiki', {
            query: all ? { all: true, } : undefined,
            options: { cache: false, },
        },);
    }

    getByRef(ref: string,): Promise<WikiPage> {
        return this.get<WikiPage>('/wiki/:ref', { params: { ref, }, },);
    }

    search(q: string, limit = 25,): Promise<WikiSearchHit[]> {
        return this.get<WikiSearchHit[]>('/wiki/search', {
            query: { q, limit, }, options: { cache: false, },
        },);
    }

    childCounts(): Promise<Record<string, number>> {
        return this.get<Record<string, number>>('/wiki/child-counts', {
            options: { cache: false, },
        },);
    }

    create(body: Partial<WikiPage>,): Promise<WikiPage> {
        return this.mutate('POST', '/wiki', { body, invalidates: ['wiki',], },);
    }

    update(id: string, body: Partial<WikiPage>,): Promise<WikiPage> {
        return this.mutate('PUT', '/wiki/:id', { params: { id, }, body, invalidates: ['wiki',], },);
    }

    /** `orphan` promotes children to roots; `cascade` removes the subtree. */
    remove(id: string, mode: WikiDeleteMode = 'orphan',): Promise<{ deleted: number; orphaned: number; }> {
        return this.mutate('DELETE', '/wiki/:id', {
            params: { id, }, query: { mode, }, invalidates: ['wiki',],
        },);
    }
}
