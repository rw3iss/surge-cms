/** Wiki pages: markdown documents arranged in a tree. */

export type WikiPageStatus = 'draft' | 'published' | 'archived';

export interface WikiPage {
    id: string;
    title: string;
    /** Optional. A page with no slug is reachable by id. */
    slug?: string | null;
    content: string;
    tags: string[];
    categories: string[];
    parentId?: string | null;
    /**
     * Roles allowed to VIEW this page. EMPTY MEANS EVERYONE — a wiki that is
     * private by accident is worse than one that is public on purpose.
     */
    viewRoles: string[];
    status: WikiPageStatus;
    position: number;
    createdBy?: string | null;
    createdAt: string;
    updatedAt: string;
}

/** A page plus its children, for the tree views. */
export interface WikiPageNode extends WikiPage {
    children: WikiPageNode[];
}

/** One search hit with its score and the matched fragments. */
export interface WikiSearchHit {
    id: string;
    title: string;
    slug?: string | null;
    /** Relevance; higher is better. */
    score: number;
    /** Plain-text excerpts with the matched terms wrapped in <mark>. */
    excerpt: string;
    updatedAt: string;
}

/** What to do with a parent's children when the parent is deleted. */
export type WikiDeleteMode = 'cascade' | 'orphan';

/** A page's public path — slug when it has one, id otherwise. */
export function wikiPagePath(page: Pick<WikiPage, 'id' | 'slug'>,): string {
    return `/wiki/${page.slug || page.id}`;
}

/** Assemble a flat list into a tree, preserving position then title order. */
export function buildWikiTree(pages: WikiPage[],): WikiPageNode[] {
    const byId = new Map<string, WikiPageNode>(
        pages.map((p,) => [p.id, { ...p, children: [], },]),
    );
    const roots: WikiPageNode[] = [];
    for (const node of byId.values()) {
        // A child whose parent is missing (filtered out by permissions, or
        // deleted mid-read) becomes a root rather than vanishing from the tree.
        const parent = node.parentId ? byId.get(node.parentId,) : undefined;
        if (parent) parent.children.push(node,);
        else roots.push(node,);
    }
    const sort = (list: WikiPageNode[],): void => {
        list.sort((a, b,) => a.position - b.position || a.title.localeCompare(b.title,));
        for (const n of list) sort(n.children,);
    };
    sort(roots,);
    return roots;
}
