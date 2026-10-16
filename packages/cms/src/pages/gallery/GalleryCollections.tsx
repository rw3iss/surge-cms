/**
 * Public gallery collections UI:
 * - `GalleryCollectionCards` — the "Collections" section on top of the gallery page.
 * - `GalleryCollectionsLayout` — wraps a collection / item page; when the
 *   Appearance setting "Show collections sidebar" is on and collections exist,
 *   adds a sticky sidebar (desktop) or a sticky dropdown (mobile), modelled on
 *   the /shop filter sidebar.
 *
 * Only collections with items the viewer can see are listed (an empty one
 * would just lead to "Nothing here yet").
 */
import type { GalleryCollection, } from '@sitesurge/types';
import { A, useNavigate, } from '@solidjs/router';
import { type Component, For, type JSX, Show, } from 'solid-js';

/** Collections worth showing to the public: those with visible items. */
export const visibleCollections = (list: GalleryCollection[] | null | undefined,): GalleryCollection[] =>
    (list ?? []).filter((c,) => c.itemCount > 0,);

const countLabel = (n: number,): string => `${n} ${n === 1 ? 'item' : 'items'}`;

export const GalleryCollectionCards: Component<{ collections: GalleryCollection[]; }> = (props,) => (
    <section class="gallery-collections" aria-labelledby="gallery-collections-heading">
        <h2 id="gallery-collections-heading" class="gallery-collections__heading">Collections</h2>
        <div class="gallery-collections__grid">
            <For each={props.collections}>
                {(c,) => (
                    <A href={c.url} class="gallery-collections__card">
                        <span class="gallery-collections__cover">
                            <Show when={c.coverThumbnailUrl} fallback={<span class="gallery-collections__cover-empty" aria-hidden="true" />}>
                                <img src={c.coverThumbnailUrl!} alt="" loading="lazy" />
                            </Show>
                        </span>
                        <span class="gallery-collections__name">{c.name}</span>
                        <span class="gallery-collections__count">{countLabel(c.itemCount,)}</span>
                    </A>
                )}
            </For>
        </div>
    </section>
);

export interface GalleryCollectionsLayoutProps {
    /** Show the sidebar at all (Appearance setting). */
    enabled: boolean;
    collections: GalleryCollection[];
    /** The current collection id; '' = none (the gallery root). */
    currentId: string;
    /** Gallery base URL, the "All items" link. */
    baseUrl: string;
    children: JSX.Element;
}

export const GalleryCollectionsLayout: Component<GalleryCollectionsLayoutProps> = (props,) => {
    const navigate = useNavigate();
    const on = () => props.enabled && props.collections.length > 0;
    return (
        <Show when={on()} fallback={props.children}>
            <div class="gallery-layout">
                {/* Mobile: a native select (what a phone user expects), sticky below the header. CSS shows this or the sidebar. */}
                <div class="gallery-layout__mobile-nav">
                    <select
                        aria-label="Collections"
                        value={props.currentId}
                        onChange={(e,) => {
                            const v = e.currentTarget.value;
                            navigate(v ? (props.collections.find((c,) => c.id === v,)?.url ?? props.baseUrl) : props.baseUrl,);
                        }}
                    >
                        <option value="">All items</option>
                        <For each={props.collections}>{(c,) => <option value={c.id}>{c.name} ({c.itemCount})</option>}</For>
                    </select>
                </div>
                <aside class="gallery-layout__sidebar" aria-label="Collections">
                    <A href={props.baseUrl} end class={`gallery-layout__link gallery-layout__link--all${props.currentId ? '' : ' is-active'}`}>
                        All items
                    </A>
                    <h2 class="gallery-layout__heading">Collections</h2>
                    <For each={props.collections}>
                        {(c,) => (
                            <A
                                href={c.url}
                                class={`gallery-layout__link${props.currentId === c.id ? ' is-active' : ''}`}
                                aria-current={props.currentId === c.id ? 'page' : undefined}
                            >
                                <span>{c.name}</span>
                                <span class="gallery-layout__count">({c.itemCount})</span>
                            </A>
                        )}
                    </For>
                </aside>
                <div class="gallery-layout__main">{props.children}</div>
            </div>
        </Show>
    );
};
