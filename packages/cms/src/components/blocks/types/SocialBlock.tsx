/**
 * Social block — pinned posts or an auto feed.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import {
    resolveSocialCount,
    resolveSocialDisplay,
    resolveSocialItemBox,
    resolveSocialNavigation,
    resolveSocialNavPadding,
} from '@sitesurge/types';
import type { Block, SocialPlatform, SocialPost, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { toFlexAlign, } from '../../../utils/cssAlign';
import SocialEmbed from '../social/SocialEmbed';

export const FEED_LAYOUT_CLASS: Record<string, string> = {
    'grid': 'social-block__grid',
    '2-col': 'social-block__grid social-block__grid--2col',
    '1-col': 'social-block__grid social-block__grid--1col',
    'row': 'social-block__grid social-block__grid--row',
};

interface SocialBlockItem {
    id?: string;
    postId?: string;
    postUrl?: string;
    thumbnailUrl?: string;
    content?: string;
    authorName?: string;
}

export const SocialBlock: Component<{ block: Block; }> = (props,) => {
    const settings = () => (props.block.settings || {}) as Record<string, any>;
    const provider = (): SocialPlatform | undefined => settings().provider as SocialPlatform | undefined;
    const items = (): SocialBlockItem[] => {
        const list = settings().items;
        return Array.isArray(list,) ? (list as SocialBlockItem[]) : [];
    };
    const filledItems = () => items().filter(i => i.postId || i.postUrl);
    /** Shared with the admin panel — the two defaulting differently is what
     *  made "Number of posts" impossible to change (the field showed 1, the
     *  renderer used 6, so typing 1 was not a change and never saved). */
    const limit = () => resolveSocialCount(settings() as never,);
    const layout = () => (settings().layout as string) || 'grid';
    const snapScroll = () => settings().snapScroll as boolean ?? false;
    const rowHeight = () => (settings().rowHeight as string) || undefined;
    /** Every "Item …" setting, read through the SAME resolver the email
     *  renderer uses — picking them out of the bag here and ignoring them there
     *  is how an operator's sizing reached the site but not the inbox. */
    const itemBox = () => resolveSocialItemBox(settings() as never,);
    const itemWidth = () => itemBox().width;
    const itemHeight = () => itemBox().height;
    /** Gap between items, any CSS length. Falls back to the block style's gap. */
    const itemGap = () => itemBox().gap;
    // Padding INSIDE the horizontal scroll row (row layout only) — set via the
    // block's main Edit properties, independent of the block-style padding.
    const rowPadding = () => (settings().rowPadding as string) || undefined;

    /*
     * Horizontal-row navigation.
     *
     * The row is a scroll container, so "paging" is just scrolling by one
     * viewport width — no transform track, no index arithmetic to keep in sync
     * with the DOM. That also means a drag or a trackpad swipe stays the
     * primary interaction and these controls agree with it for free, because
     * both move the same `scrollLeft`.
     */
    const navigation = () => resolveSocialNavigation(settings() as never,);
    const navPadding = () => resolveSocialNavPadding(settings() as never,);
    const itemRadius = () => itemBox().borderRadius;

    let scroller: HTMLDivElement | undefined;
    const [page, setPage,] = createSignal(0,);
    const [pageCount, setPageCount,] = createSignal(1,);

    const measure = (): void => {
        const el = scroller;
        if (!el) return;
        // `clientWidth` is one page. Round rather than ceil on the position so a
        // half-scrolled row reports the page it is mostly showing.
        const pages = el.clientWidth > 0 ? Math.max(1, Math.ceil(el.scrollWidth / el.clientWidth,),) : 1;
        setPageCount(pages,);
        setPage(Math.min(pages - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth,),),),);
    };

    const goTo = (p: number,): void => {
        const el = scroller;
        if (!el) return;
        const target = Math.max(0, Math.min(pageCount() - 1, p,),);
        el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth', },);
        setPage(target,);
    };

    onMount(() => {
        if (!scroller) return;
        measure();
        const el = scroller;
        el.addEventListener('scroll', measure, { passive: true, },);
        // The page count depends on the container's width AND the cards', both
        // of which change after images load and on resize.
        const ro = new ResizeObserver(measure,);
        ro.observe(el,);
        onCleanup(() => {
            el.removeEventListener('scroll', measure,);
            ro.disconnect();
        },);
    },);

    /** Arrows are pointless when everything already fits. */
    const hasOverflow = () => pageCount() > 1;
    const blockStyle = () => props.block.style as Record<string, any> | undefined;

    /**
     * Is this height a DEFINITE length — one that gives a box a real size on
     * its own, without asking its parent?
     *
     * Only a definite height may switch off an embedded player's aspect ratio.
     * A percentage resolves against the parent's height, and these containers
     * are content-sized: the grid's height comes FROM the posts, so a
     * percentage inside resolves to `auto`. Dropping the ratio there leaves the
     * iframe with no intrinsic height at all and it collapses to the HTML
     * default of 150px — a full-width video squashed into a strip.
     *
     * `%` anywhere disqualifies the value, including inside calc()/clamp(),
     * because such a value is only as definite as the percentage it contains.
     */
    const isDefiniteHeight = (v: string | undefined,): boolean => {
        if (!v) return false;
        const s = v.trim().toLowerCase();
        if (!s || s === 'auto' || s.includes('%',)) return false;
        // A bare number is treated as px elsewhere in the editor; anything with
        // a real unit is definite. `min-content`/`fit-content`/… are sized by
        // content, so they are not.
        return /^-?\d*\.?\d+(px|rem|em|vh|vw|vmin|vmax|pt|pc|cm|mm|in|ch|ex|q)?$/.test(s,);
    };

    /** Content kind (YouTube: short | live | video); undefined = any. */
    const kind = () => (settings().kind as string) || undefined;

    /**
     * Media size + title visibility. Applied to BOTH the pinned and the
     * auto-feed branch — they render the same component, so a setting that
     * reached only one of them would be a bug waiting to be reported.
     */
    const display = () => resolveSocialDisplay(settings() as never,);

    /**
     * Pinning is explicit now (`usePinned`), not inferred from whether any slot
     * happens to be filled. Inferring meant a half-filled slot list silently
     * switched the block out of auto-feed mode.
     *
     * Legacy blocks predate the flag, so filled slots still imply pinning for
     * them — otherwise an existing hand-curated block would start auto-feeding.
     */
    const usePinned = () => (settings().usePinned === undefined ?
        filledItems().length > 0 :
        Boolean(settings().usePinned,));
    const useAutoFeed = () => !usePinned();

    const [posts,] = createResource(
        () => useAutoFeed() ? `${provider()}:${limit()}:${kind() ?? ''}` : '',
        async (key,) => {
            if (!key) return [];
            const p = provider();
            if (!p) return [];
            try {
                // The kind filter has to reach the FEED, not just the admin
                // picker: a block set to "Shorts" that renders every kind is
                // not doing what the panel says.
                const { data, } = await cms.social.platformPosts(p, {
                    limit: limit(),
                    sort: 'date',
                    sortDir: 'desc',
                    ...(kind() ? { kind: kind(), } : {}),
                } as any,);
                return (data ?? []) as SocialPost[];
            } catch {
                return [];
            }
        },
    );

    return (
        <div class={`social-block social-block--nav-${navigation()}`}>
            <Show
                when={useAutoFeed() ? (posts()?.length ?? 0) > 0 : filledItems().length > 0}
                fallback={
                    <Show when={!posts.loading}>
                        <p class="social-block__empty">No social posts available.</p>
                    </Show>
                }
            >
                <div
                    ref={scroller}
                    // The resolved alignment as an attribute, so the stylesheet can
                    // branch on it statically. It cannot branch on --block-h-align:
                    // `safe` is only valid with POSITIONAL values, and
                    // `justify-content: safe var(--x)` resolving to `safe space-between`
                    // is invalid at computed-value time — which silently resets the
                    // property to `normal` rather than falling back.
                    data-h-align={toFlexAlign((props.block.style as any)?.horizontalAlign, '',) || undefined}
                    class={`${FEED_LAYOUT_CLASS[layout()] || FEED_LAYOUT_CLASS.grid}${
                        !snapScroll() ? ' social-block__grid--no-snap' : ''
                    }${itemHeight() ? ' social-block__grid--fixed-height' : ''}${
                        itemWidth() && layout() !== 'row' ? ' social-block__grid--fixed-width' : ''
                    }`}
                    style={{
                        // ONLY the Row layout's own `rowPadding`, which is a
                        // separate setting that deliberately lands INSIDE the
                        // scroller so the first and last cards clear the edge.
                        //
                        // The block's STYLE padding is not applied here. It is
                        // already emitted onto the block wrapper by `blockCss`
                        // (social blocks use WRAPPER_ONLY targets), so applying it
                        // again here charged it twice: a 15px padding took 30px off
                        // each side, and — worse — every percentage the operator set
                        // on the items then resolved against the doubly-shrunk
                        // content box. `clamp(300px, 100%, 800px)` on a 360px column
                        // came out at its 300px floor instead of filling the space,
                        // which reads as "item width is being ignored" when it is
                        // in fact being measured against the wrong box.
                        //
                        // Block style belongs to the block; the item props below
                        // (--social-item-width/height) size the posts.
                        ...(layout() === 'row' && rowPadding() ? { padding: rowPadding(), } : {}),
                        // The block's own Item gap wins over the style panel's gap:
                        // it is the more specific control and the one next to the
                        // width/height fields it pairs with.
                        ...(itemGap() ?
                            { gap: itemGap(), } :
                            (blockStyle()?.gap ? { gap: blockStyle()!.gap, } : {})),
                        // rowHeight only constrains card height in the row layout;
                        // the outer block dimensions are left to the block style system.
                        ...(layout() === 'row' && rowHeight() ? { '--social-row-height': rowHeight(), } : {}),
                        // Even per-post sizing. itemWidth drives the grid track width
                        // (auto-fill keeps columns even); itemHeight fixes card height.
                        ...(itemWidth() ? { '--social-item-width': itemWidth(), } : {}),
                        ...(itemHeight() ? { '--social-item-height': itemHeight(), } : {}),
                        // Each post's own corner radius, inherited by every
                        // `.social-embed` below rather than applied per card —
                        // the auto-feed and pinned branches render the same
                        // component, and setting it in one place is what keeps
                        // them from drifting. `.social-embed` is already
                        // `overflow: hidden`, so the iframe inside it is
                        // clipped to the rounding.
                        ...(itemRadius() ? { '--social-item-radius': itemRadius(), } : {}),
                        // An embedded player keeps its natural aspect ratio UNLESS a
                        // height was configured, in which case the height must win or
                        // the card grows and the video sits in it with dead space
                        // below. The stylesheet reads this as
                        // `aspect-ratio: var(--social-embed-ratio, 16 / 9)`.
                        //
                        // Decided here rather than in CSS because this is the only
                        // place that knows whether a height was actually set — CSS
                        // cannot test whether a custom property has a value, and the
                        // row layout's attempt to assume one collapsed every unsized
                        // player to the iframe's default 150px.
                        //
                        // DEFINITE heights only (see isDefiniteHeight). `height:100%`
                        // is the natural way to say "fill the slot", and it resolves
                        // to `auto` here because these containers are sized by their
                        // content — so switching the ratio off for it collapsed the
                        // player to 150px, the same failure in a different disguise.
                        // With the ratio kept, the video takes its natural height and
                        // pushes the container, and the percentage still stretches it
                        // whenever an ancestor does have a definite height.
                        ...((isDefiniteHeight(itemHeight(),) ||
                                (layout() === 'row' && isDefiniteHeight(rowHeight(),))) ?
                            { '--social-embed-ratio': 'auto', } :
                            {}),
                    }}
                >
                    <Show
                        when={useAutoFeed()}
                        fallback={
                            <For each={filledItems()}>
                                {(item,) => (
                                    <SocialEmbed
                                        platform={provider()!}
                                        externalId={item.postId || ''}
                                        mediaUrl={item.postUrl || ''}
                                        content={item.content || ''}
                                        thumbnailUrl={item.thumbnailUrl}
                                        authorName={item.authorName}
                                        // A pinned slot has no stored kind, so fall back to
                                        // whatever the block is configured to show.
                                        mediaKind={(item as { mediaKind?: any; }).mediaKind ?? kind() as any}
                                        mediaDisplay={display().mediaDisplay}
                                        showTitle={display().showTitle}
                                        showAuthor={display().showAuthor}
                                        showDate={display().showDate}
                                        publishedAt={(item as { publishedAt?: string; }).publishedAt}
                                    />
                                )}
                            </For>
                        }
                    >
                        {
                            /* Sliced as well as requested: the count is the block's
                            setting, so it should hold even if the feed returns
                            more than asked (a cached response, a provider that
                            ignores the limit). */
                        }
                        <For each={(posts() ?? []).slice(0, limit(),)}>
                            {(post,) => (
                                <SocialEmbed
                                    platform={post.platform}
                                    externalId={post.externalId}
                                    mediaUrl={post.mediaUrl}
                                    content={post.content}
                                    thumbnailUrl={post.thumbnailUrl}
                                    authorName={post.authorName}
                                    mediaKind={(post as { mediaKind?: any; }).mediaKind ?? kind() as any}
                                    mediaDisplay={display().mediaDisplay}
                                    showTitle={display().showTitle}
                                    showAuthor={display().showAuthor}
                                    showDate={display().showDate}
                                    publishedAt={(post as { publishedAt?: string; }).publishedAt}
                                />
                            )}
                        </For>
                    </Show>
                </div>

                {
                    /* Side arrows sit OVER the row's own edges; bottom arrows and
                    dots sit under it. Both are suppressed when nothing
                    overflows — a control that cannot move anything is worse
                    than no control. */
                }
                <Show when={navigation() === 'side-arrows' && hasOverflow()}>
                    <span
                        class="social-block__nav-slot social-block__nav-slot--prev"
                        style={{ padding: navPadding(), }}
                    >
                        <button
                            type="button"
                            class="social-block__nav-arrow"
                            aria-label="Previous"
                            disabled={page() <= 0}
                            onClick={() => goTo(page() - 1,)}
                        >
                            <span aria-hidden="true">‹</span>
                        </button>
                    </span>
                    <span
                        class="social-block__nav-slot social-block__nav-slot--next"
                        style={{ padding: navPadding(), }}
                    >
                        <button
                            type="button"
                            class="social-block__nav-arrow"
                            aria-label="Next"
                            disabled={page() >= pageCount() - 1}
                            onClick={() => goTo(page() + 1,)}
                        >
                            <span aria-hidden="true">›</span>
                        </button>
                    </span>
                </Show>

                <Show when={navigation() === 'dots' && hasOverflow()}>
                    <div class="social-block__nav social-block__nav--dots" style={{ padding: navPadding(), }}>
                        <For each={Array.from({ length: pageCount(), },)}>
                            {(_, i,) => (
                                <button
                                    type="button"
                                    class={`social-block__dot${page() === i() ? ' social-block__dot--active' : ''}`}
                                    aria-label={`Go to page ${i() + 1}`}
                                    aria-current={page() === i() ? 'true' : undefined}
                                    onClick={() => goTo(i(),)}
                                />
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={navigation() === 'bottom-arrows' && hasOverflow()}>
                    <div class="social-block__nav social-block__nav--arrows">
                        <span class="social-block__nav-slot" style={{ padding: navPadding(), }}>
                            <button
                                type="button"
                                class="social-block__nav-arrow"
                                aria-label="Previous"
                                disabled={page() <= 0}
                                onClick={() => goTo(page() - 1,)}
                            >
                                <span aria-hidden="true">‹</span>
                            </button>
                        </span>
                        <span class="social-block__nav-slot" style={{ padding: navPadding(), }}>
                            <button
                                type="button"
                                class="social-block__nav-arrow"
                                aria-label="Next"
                                disabled={page() >= pageCount() - 1}
                                onClick={() => goTo(page() + 1,)}
                            >
                                <span aria-hidden="true">›</span>
                            </button>
                        </span>
                    </div>
                </Show>
            </Show>
        </div>
    );
};
