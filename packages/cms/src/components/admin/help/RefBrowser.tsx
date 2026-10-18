/**
 * Reference browser — the shared layout of the generated reference pages
 * (`/admin/help/sdk/reference`, `/admin/help/api`).
 *
 * Sticky table of contents on the left, a filter box + expand/collapse-all
 * toolbar, and one collapsible group per module. Every item carries an anchor
 * id, so `#cms.posts.list` / `#get-/api/v1/posts` deep-link: the group opens,
 * the filter clears if it would hide the target, and the item scrolls into
 * view highlighted.
 *
 * The filter lives in `?q=` too (shareable, kept on reload / Back).
 *
 * Filtering never rebuilds the tree: groups and items render from the
 * original (static) data and are shown/hidden from a memoised visibility set,
 * so typing doesn't remount hundreds of rows.
 */
import { A, useLocation, useSearchParams, } from '@solidjs/router';
import { Component, For, Show, createEffect, createMemo, createSignal, type JSX, on, } from 'solid-js';
import { inlineCode, } from './inlineCode';
import './RefBrowser.scss';

export interface RefItem {
    /** Element id — the deep-link target. */
    anchor: string;
    /** Lower-cased text the filter matches against. */
    search: string;
    render: () => JSX.Element;
}

export interface RefSection {
    /** Anchor + label for a sub-group (e.g. `cms.shop.products`); omit for none. */
    id?: string;
    label?: string;
    items: RefItem[];
}

export interface RefGroup {
    id: string;
    label: string;
    /** Short secondary text after the label (mount path, class name). */
    meta?: string;
    description?: string;
    /** Lower-cased text every item of the group also matches on. */
    search: string;
    sections: RefSection[];
}

export interface RefBrowserProps {
    groups: RefGroup[];
    /** Route of the page, used to build `#anchor` links the router can follow. */
    basePath: string;
    placeholder: string;
    /** [singular, plural] item noun for counts. */
    noun: [string, string];
    /** Extra narrowing (method / auth selects). Read reactively. */
    itemFilter?: (item: RefItem,) => boolean;
    /** True when `itemFilter` currently narrows anything (auto-expands groups). */
    itemFilterActive?: () => boolean;
    /** Clear the extra narrowing (used when a deep link targets a hidden item). */
    onClearItemFilter?: () => void;
    toolbar?: JSX.Element;
}

const RefBrowser: Component<RefBrowserProps> = (props,) => {
    const location = useLocation();
    // A search-as-you-type box: filtering per keystroke is the point, and it
    // lifts nothing to a parent — so not the commit-on-blur rule.
    // The filter is mirrored to `?q=` (replace, no history entries), so a
    // filtered view can be shared and survives reload / Back.
    const [search, setSearch,] = useSearchParams<{ q?: string; }>();
    const [query, setQueryLocal,] = createSignal(typeof search.q === 'string' ? search.q : '',);
    const setQuery = (v: string,) => {
        setQueryLocal(v,);
        setSearch({ q: v.trim() ? v : undefined, }, { replace: true, scroll: false, },);
    };
    const [open, setOpen,] = createSignal<Set<string>>(new Set(),);
    const [target, setTarget,] = createSignal('',);

    const tokens = createMemo(() => query().trim().toLowerCase().split(/\s+/,).filter(Boolean,));
    const filtering = () => tokens().length > 0 || !!props.itemFilterActive?.();

    /** Every visible item anchor, plus each group id with a visible item. */
    const visible = createMemo(() => {
        const t = tokens();
        const extra = props.itemFilter;
        const set = new Set<string>();
        for (const g of props.groups) {
            let any = false;
            for (const s of g.sections) {
                let anyInSection = false;
                for (const it of s.items) {
                    if (extra && !extra(it,)) continue;
                    const hay = `${g.search} ${it.search}`;
                    if (t.every((tok,) => hay.includes(tok,))) {
                        set.add(it.anchor,);
                        any = true;
                        anyInSection = true;
                    }
                }
                if (anyInSection && s.id) set.add(s.id,);
            }
            if (any) set.add(g.id,);
        }
        return set;
    },);

    const countIn = (g: RefGroup,) => {
        const v = visible();
        return g.sections.reduce((n, s,) => n + s.items.filter((it,) => v.has(it.anchor,)).length, 0,);
    };
    const total = createMemo(() => props.groups.reduce((n, g,) => n + countIn(g,), 0,));
    const shownGroups = () => props.groups.filter((g,) => visible().has(g.id,));

    // A filter opens every group that still has a match; clearing it leaves
    // whatever is open alone.
    createEffect(on([tokens, () => props.itemFilterActive?.(),], () => {
        if (filtering()) setOpen(new Set(shownGroups().map((g,) => g.id),),);
    },),);

    const isOpen = (id: string,) => open().has(id,);
    const toggle = (id: string,) => {
        const next = new Set(open(),);
        if (next.has(id,)) next.delete(id,);
        else next.add(id,);
        setOpen(next,);
    };

    // ── Deep links ───────────────────────────────────────────────────────
    const groupOf = (id: string,): RefGroup | undefined =>
        props.groups.find((g,) =>
            g.id === id || g.sections.some((s,) => s.id === id || s.items.some((it,) => it.anchor === id,))
        );

    createEffect(on(() => location.hash, (hash,) => {
        const id = decodeURIComponent((hash ?? '').replace(/^#/, '',),);
        if (!id) return;
        const g = groupOf(id,);
        if (!g) return;
        if (!visible().has(id,)) {
            // Clear the filter but KEEP the hash (a router navigation would drop it).
            setQueryLocal('',);
            if (typeof window !== 'undefined') {
                const u = new URL(window.location.href,);
                u.searchParams.delete('q',);
                window.history.replaceState(window.history.state, '', u,);
            }
            props.onClearItemFilter?.();
        }
        setOpen(new Set([...open(), g.id,],),);
        setTarget(id,);
        // Two frames: one for the group body to mount, one for layout.
        requestAnimationFrame(() =>
            requestAnimationFrame(() => document.getElementById(id,)?.scrollIntoView({ block: 'start', },))
        );
    },),);

    const href = (id: string,) => `${props.basePath}#${id}`;
    const plural = (n: number,) => (n === 1 ? props.noun[0] : props.noun[1]);

    return (
        <div class="ref-browser">
            <aside class="ref-browser__toc" aria-label="Contents">
                <ul>
                    <For each={props.groups}>
                        {(g,) => (
                            <Show when={visible().has(g.id,)}>
                                <li>
                                    <A
                                        href={href(g.id,)}
                                        class="ref-browser__toc-link"
                                        classList={{ 'ref-browser__toc-link--open': isOpen(g.id,), }}
                                    >
                                        <span>{g.label}</span>
                                        <span class="ref-browser__toc-count">{countIn(g,)}</span>
                                    </A>
                                    <Show when={g.sections.some((s,) => s.id,)}>
                                        <ul>
                                            <For each={g.sections.filter((s,) => s.id,)}>
                                                {(s,) => (
                                                    <Show when={visible().has(s.id!,)}>
                                                        <li>
                                                            <A href={href(s.id!,)} class="ref-browser__toc-sub">
                                                                {s.label}
                                                            </A>
                                                        </li>
                                                    </Show>
                                                )}
                                            </For>
                                        </ul>
                                    </Show>
                                </li>
                            </Show>
                        )}
                    </For>
                </ul>
            </aside>

            <div class="ref-browser__main">
                <div class="ref-browser__toolbar">
                    <input
                        type="search"
                        class="ref-browser__filter"
                        placeholder={props.placeholder}
                        value={query()}
                        onInput={(e,) => setQuery(e.currentTarget.value,)}
                        aria-label={props.placeholder}
                    />
                    {props.toolbar}
                    <span class="ref-browser__total">
                        {total()} {plural(total(),)}
                    </span>
                    <button
                        type="button"
                        class="btn btn--small btn--outline"
                        onClick={() => setOpen(new Set(shownGroups().map((g,) => g.id),),)}
                    >
                        Expand all
                    </button>
                    <button type="button" class="btn btn--small btn--outline" onClick={() => setOpen(new Set<string>(),)}>
                        Collapse all
                    </button>
                </div>

                <Show when={total() > 0} fallback={<p class="help-doc__desc">Nothing matches that filter.</p>}>
                    <For each={props.groups}>
                        {(g,) => (
                            <Show when={visible().has(g.id,)}>
                                <section
                                    id={g.id}
                                    class="ref-browser__group"
                                    classList={{ 'ref-browser__group--target': target() === g.id, }}
                                >
                                    <div class="ref-browser__group-head">
                                        <button
                                            type="button"
                                            class="ref-browser__toggle"
                                            aria-expanded={isOpen(g.id,)}
                                            aria-controls={`${g.id}-body`}
                                            onClick={() => toggle(g.id,)}
                                        >
                                            <span class="ref-browser__chevron">{isOpen(g.id,) ? '▼' : '▶'}</span>
                                            <code class="ref-browser__label">{g.label}</code>
                                            <Show when={g.meta}>
                                                <span class="ref-browser__meta">{g.meta}</span>
                                            </Show>
                                            <span class="ref-browser__count">
                                                {countIn(g,)} {plural(countIn(g,),)}
                                            </span>
                                        </button>
                                        <A href={href(g.id,)} class="ref-browser__hash" title="Link to this section">#</A>
                                    </div>

                                    <Show when={isOpen(g.id,)}>
                                        <div class="ref-browser__body" id={`${g.id}-body`}>
                                            <Show when={g.description}>
                                                <p class="ref-browser__desc">{inlineCode(g.description!,)}</p>
                                            </Show>
                                            <For each={g.sections}>
                                                {(s,) => (
                                                    <Show when={!s.id || visible().has(s.id,)}>
                                                        <Show when={s.label}>
                                                            <h3
                                                                id={s.id}
                                                                class="ref-browser__section"
                                                                classList={{ 'ref-browser__section--target': target() === s.id, }}
                                                            >
                                                                <code>{s.label}</code>
                                                            </h3>
                                                        </Show>
                                                        <For each={s.items}>
                                                            {(it,) => (
                                                                <Show when={visible().has(it.anchor,)}>
                                                                    <div
                                                                        id={it.anchor}
                                                                        class="ref-item"
                                                                        classList={{ 'ref-item--target': target() === it.anchor, }}
                                                                    >
                                                                        {it.render()}
                                                                    </div>
                                                                </Show>
                                                            )}
                                                        </For>
                                                    </Show>
                                                )}
                                            </For>
                                        </div>
                                    </Show>
                                </section>
                            </Show>
                        )}
                    </For>
                </Show>
            </div>
        </div>
    );
};

export default RefBrowser;
