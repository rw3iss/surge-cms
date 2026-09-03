/**
 * Public wiki: index tree, single page, and search results.
 *
 * Three routed components in one file because they share the tree shape, the
 * search box and the styling — splitting them would mean duplicating all three.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import type { WikiPage, WikiPageNode, } from '@sitesurge/types';
import { buildWikiTree, renderMarkdown, wikiPagePath, } from '@sitesurge/types';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import './Wiki.scss';

/** Shared search box — the index and the results page both lead with it. */
const WikiSearchBox: Component<{ initial?: string; autofocus?: boolean; }> = (props,) => {
    const navigate = useNavigate();
    const [q, setQ,] = createSignal(props.initial ?? '',);
    return (
        <form
            class="wiki-search"
            onSubmit={(e,) => {
                e.preventDefault();
                const term = q().trim();
                if (term) navigate(`/wiki/search?q=${encodeURIComponent(term,)}`,);
            }}
        >
            <input
                type="search"
                class="wiki-search__input"
                placeholder="Search the wiki…"
                value={q()}
                autofocus={props.autofocus}
                onInput={(e,) => setQ(e.currentTarget.value,)}
            />
            <button type="submit" class="btn btn--primary wiki-search__btn">Search</button>
        </form>
    );
};

const formatDate = (iso: string,) =>
    new Date(iso,).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', },);

/**
 * One node of the public tree.
 *
 * `openIds` forces a branch open — used when viewing a page so its ancestors
 * are expanded and the page is visible in the sidebar without hunting for it.
 */
const TreeRow: Component<{
    node: WikiPageNode;
    depth: number;
    currentId?: string;
    openIds?: Set<string>;
    compact?: boolean;
}> = (props,) => {
    const forcedOpen = () => Boolean(props.openIds?.has(props.node.id,));
    const [open, setOpen,] = createSignal(props.depth < 1 || forcedOpen(),);
    // A branch containing the current page opens even if the reader collapsed it
    // on a previous page — otherwise "where am I" has no answer.
    createEffect(() => { if (forcedOpen()) setOpen(true,); },);
    const hasChildren = () => props.node.children.length > 0;
    return (
        <li class="wiki-tree__item">
            <div class="wiki-tree__row" style={{ 'padding-left': `${props.depth * 20}px`, }}>
                <button
                    type="button"
                    class="wiki-tree__chev"
                    onClick={() => setOpen(!open(),)}
                    disabled={!hasChildren()}
                    aria-label={hasChildren() ? (open() ? 'Collapse' : 'Expand') : undefined}
                >
                    {hasChildren() ? (open() ? '▾' : '▸') : '·'}
                </button>

                <A
                    href={wikiPagePath(props.node,)}
                    class={`wiki-tree__link${
                        props.currentId === props.node.id ? ' wiki-tree__link--current' : ''
                    }`}
                >
                    {props.node.title}
                </A>

                <Show when={hasChildren()}>
                    <span class="wiki-tree__count">{props.node.children.length}</span>
                </Show>

                <span class="wiki-tree__spacer" />

                {/* Both dates inline, as asked — "added" answers how old a page
                    is, "updated" whether it is still maintained. The sidebar
                    drops them: at that width they push the title out. */}
                <Show when={!props.compact}>
                <span class="wiki-tree__dates">
                    <span title="Date added">Added {formatDate(props.node.createdAt,)}</span>
                    <span class="wiki-tree__dot">·</span>
                    <span title="Last updated">Updated {formatDate(props.node.updatedAt,)}</span>
                </span>
                </Show>
            </div>

            <Show when={open() && hasChildren()}>
                <ul class="wiki-tree__children">
                    <For each={props.node.children}>
                        {(child,) => (
                            <TreeRow
                                node={child}
                                depth={props.depth + 1}
                                currentId={props.currentId}
                                openIds={props.openIds}
                                compact={props.compact}
                            />
                        )}
                    </For>
                </ul>
            </Show>
        </li>
    );
};

/** /wiki — the index. */
export const WikiIndex: Component = () => {
    const [pages] = createResource(async () => {
        try { return await cms.wiki.list(); } catch { return [] as WikiPage[]; }
    },);
    const tree = createMemo(() => buildWikiTree(pages() ?? [],),);

    return (
        <div class="wiki-page page-wrapper">
            <Title>Wiki</Title>
            <SeoHead title="Wiki" description="Browse and search the wiki." type="website" />

            <header class="wiki-page__header">
                <h1>Wiki</h1>
                <p class="wiki-page__lead">Browse the tree, or search everything.</p>
            </header>

            <WikiSearchBox />

            <Show
                when={!pages.loading}
                fallback={<p class="wiki-page__muted">Loading…</p>}
            >
                <Show
                    when={tree().length > 0}
                    fallback={<p class="wiki-page__muted">No wiki pages yet.</p>}
                >
                    <ul class="wiki-tree">
                        <For each={tree()}>{(node,) => <TreeRow node={node} depth={0} />}</For>
                    </ul>
                </Show>
            </Show>
        </div>
    );
};

/** /wiki/search?q= — results with highlighted excerpts. */
export const WikiSearch: Component = () => {
    const [params] = useSearchParams<{ q: string; }>();
    const [hits] = createResource(
        () => params.q ?? '',
        async (q,) => {
            if (!q.trim()) return [];
            try { return await cms.wiki.search(q,); } catch { return []; }
        },
    );

    return (
        <div class="wiki-page page-wrapper">
            <Title>Wiki search</Title>
            <A href="/wiki" class="wiki-page__back">← Wiki index</A>

            <header class="wiki-page__header">
                <h1>Search</h1>
            </header>

            <WikiSearchBox initial={params.q ?? ''} autofocus />

            <Show when={!hits.loading} fallback={<p class="wiki-page__muted">Searching…</p>}>
                <p class="wiki-page__muted wiki-results__count">
                    {(hits()?.length ?? 0) === 0
                        ? `No matches for “${params.q ?? ''}”.`
                        : `${hits()!.length} result${hits()!.length !== 1 ? 's' : ''} for “${params.q}”, best first.`}
                </p>

                <ul class="wiki-results">
                    <For each={hits() ?? []}>
                        {(hit,) => (
                            <li class="wiki-results__item">
                                <A href={wikiPagePath(hit,)} class="wiki-results__title">{hit.title}</A>
                                {/* The excerpt arrives from ts_headline with the
                                    matched terms already wrapped in <mark>. It is
                                    server-generated from stored content, not user
                                    input echoed back. */}
                                <p class="wiki-results__excerpt" innerHTML={hit.excerpt} />
                                <div class="wiki-results__meta">
                                    Updated {formatDate(hit.updatedAt,)}
                                    <span class="wiki-tree__dot">·</span>
                                    score {hit.score.toFixed(2,)}
                                </div>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
        </div>
    );
};

/** /wiki/:ref — one page, with the tree alongside it. */
export const WikiPageView: Component = () => {
    const params = useParams<{ ref: string; }>();
    const [page] = createResource(
        () => params.ref,
        async (ref,) => {
            try { return await cms.wiki.getByRef(ref,); } catch { return null; }
        },
    );
    const [all] = createResource(async () => {
        try { return await cms.wiki.list(); } catch { return [] as WikiPage[]; }
    },);

    const tree = createMemo(() => buildWikiTree(all() ?? [],),);

    /** Children of this page, so a section index links onward. */
    const children = createMemo(() =>
        (all() ?? []).filter((p,) => p.parentId === page()?.id));

    /**
     * The current page's ancestors, so the sidebar opens the branch containing
     * it. Walking parents rather than searching the tree keeps this O(depth).
     */
    const ancestorIds = createMemo(() => {
        const byId = new Map((all() ?? []).map((p,) => [p.id, p,]),);
        const out = new Set<string>();
        let cursor = page()?.parentId ?? null;
        // Guard the walk: a cycle would otherwise hang the render. The server
        // rejects cycles, but a stale client list should not be able to lock up.
        let hops = 0;
        while (cursor && hops < 50) {
            out.add(cursor,);
            cursor = byId.get(cursor,)?.parentId ?? null;
            hops += 1;
        }
        return out;
    },);

    return (
        <div class="wiki-page wiki-page--with-nav page-wrapper">
            <Show
                when={page()}
                fallback={
                    <Show when={!page.loading} fallback={<p class="wiki-page__muted">Loading…</p>}>
                        <div class="wiki-page__notfound">
                            <h1>Page not found</h1>
                            <A href="/wiki" class="btn btn--primary">Back to the wiki</A>
                        </div>
                    </Show>
                }
            >
                {(p,) => (
                    <>
                        <Title>{p().title}</Title>
                        <SeoHead title={p().title} type="article" />

                        <div class="wiki-layout">
                            {/* Sidebar: the whole tree, so a reader can move
                                between pages without returning to the index. */}
                            <aside class="wiki-layout__nav">
                                <A href="/wiki" class="wiki-layout__nav-title">Wiki</A>
                                <Show when={tree().length > 0}>
                                    <ul class="wiki-tree wiki-tree--compact">
                                        <For each={tree()}>
                                            {(node,) => (
                                                <TreeRow
                                                    node={node}
                                                    depth={0}
                                                    compact
                                                    currentId={p().id}
                                                    openIds={ancestorIds()}
                                                />
                                            )}
                                        </For>
                                    </ul>
                                </Show>
                            </aside>

                            <div class="wiki-layout__content">
                                <header class="wiki-page__header">
                                    <h1>{p().title}</h1>
                                    <p class="wiki-page__dates">
                                        Added {formatDate(p().createdAt,)}
                                        <span class="wiki-tree__dot">·</span>
                                        Updated {formatDate(p().updatedAt,)}
                                    </p>
                                    <Show when={p().tags.length > 0}>
                                        <div class="wiki-page__tags">
                                            <For each={p().tags}>
                                                {(t,) => <span class="wiki-page__tag">{t}</span>}
                                            </For>
                                        </div>
                                    </Show>
                                </header>

                                {/* renderMarkdown escapes before formatting, so its
                                    output is safe to inject without a sanitiser. */}
                                <article
                                    class="wiki-page__body rich-text"
                                    innerHTML={renderMarkdown(p().content,)}
                                />

                                <Show when={children().length > 0}>
                                    <section class="wiki-page__children">
                                        <h2>In this section</h2>
                                        <ul>
                                            <For each={children()}>
                                                {(c,) => (
                                                    <li><A href={wikiPagePath(c,)}>{c.title}</A></li>
                                                )}
                                            </For>
                                        </ul>
                                    </section>
                                </Show>
                            </div>
                        </div>
                    </>
                )}
            </Show>
        </div>
    );
};

export default WikiIndex;
