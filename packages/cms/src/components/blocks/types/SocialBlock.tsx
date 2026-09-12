/**
 * Social block — pinned posts or an auto feed.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, SocialPlatform, SocialPost, } from '@sitesurge/types';
import { Component, For, Show, createResource, } from 'solid-js';
import { A, } from '@solidjs/router';
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
    const provider = (): SocialPlatform | undefined =>
        settings().provider as SocialPlatform | undefined;
    const items = (): SocialBlockItem[] => {
        const list = settings().items;
        return Array.isArray(list,) ? (list as SocialBlockItem[]) : [];
    };
    const filledItems = () => items().filter(i => i.postId || i.postUrl,);
    const count = (): number => Number(settings().count ?? items().length ?? 0);
    const limit = () => (settings().limit as number) || count() || 6;
    const layout = () => (settings().layout as string) || 'grid';
    const snapScroll = () => settings().snapScroll as boolean ?? false;
    const rowHeight = () => (settings().rowHeight as string) || undefined;
    const itemWidth = () => (settings().itemWidth as string) || undefined;
    const itemHeight = () => (settings().itemHeight as string) || undefined;
    /** Gap between items, any CSS length. Falls back to the block style's gap. */
    const itemGap = () => (settings().itemGap as string) || undefined;
    // Padding INSIDE the horizontal scroll row (row layout only) — set via the
    // block's main Edit properties, independent of the block-style padding.
    const rowPadding = () => (settings().rowPadding as string) || undefined;
    const blockStyle = () => props.block.style as Record<string, any> | undefined;

    /** Content kind (YouTube: short | live | video); undefined = any. */
    const kind = () => (settings().kind as string) || undefined;

    /**
     * Pinning is explicit now (`usePinned`), not inferred from whether any slot
     * happens to be filled. Inferring meant a half-filled slot list silently
     * switched the block out of auto-feed mode.
     *
     * Legacy blocks predate the flag, so filled slots still imply pinning for
     * them — otherwise an existing hand-curated block would start auto-feeding.
     */
    const usePinned = () => (settings().usePinned === undefined
        ? filledItems().length > 0
        : Boolean(settings().usePinned,));
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
        <div class="social-block">
            <Show
                when={useAutoFeed() ? (posts()?.length ?? 0) > 0 : filledItems().length > 0}
                fallback={
                    <Show when={!posts.loading}>
                        <p class="social-block__empty">No social posts available.</p>
                    </Show>
                }
            >
                <div
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
                        // Scroll-container padding: the Horizontal Row layout uses
                        // its own `rowPadding` (set in the block's main properties)
                        // when provided, so the block-style padding can stay on the
                        // block wrapper. Other layouts keep the style padding here.
                        ...((layout() === 'row' && rowPadding())
                            ? { padding: rowPadding(), }
                            : (blockStyle()?.padding ? { padding: blockStyle()!.padding, } : {})),
                        // The block's own Item gap wins over the style panel's gap:
                        // it is the more specific control and the one next to the
                        // width/height fields it pairs with.
                        ...(itemGap()
                            ? { gap: itemGap(), }
                            : (blockStyle()?.gap ? { gap: blockStyle()!.gap, } : {})),
                        // rowHeight only constrains card height in the row layout;
                        // the outer block dimensions are left to the block style system.
                        ...(layout() === 'row' && rowHeight() ? { '--social-row-height': rowHeight(), } : {}),
                        // Even per-post sizing. itemWidth drives the grid track width
                        // (auto-fill keeps columns even); itemHeight fixes card height.
                        ...(itemWidth() ? { '--social-item-width': itemWidth(), } : {}),
                        ...(itemHeight() ? { '--social-item-height': itemHeight(), } : {}),
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
                        ...((itemHeight() || (layout() === 'row' && rowHeight()))
                            ? { '--social-embed-ratio': 'auto', }
                            : {}),
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
                                    />
                                )}
                            </For>
                        }
                    >
                        <For each={posts()}>
                            {(post,) => (
                                <SocialEmbed
                                    platform={post.platform}
                                    externalId={post.externalId}
                                    mediaUrl={post.mediaUrl}
                                    content={post.content}
                                    thumbnailUrl={post.thumbnailUrl}
                                    authorName={post.authorName}
                                    mediaKind={(post as { mediaKind?: any; }).mediaKind ?? kind() as any}
                                />
                            )}
                        </For>
                    </Show>
                </div>
            </Show>
        </div>
    );
};
