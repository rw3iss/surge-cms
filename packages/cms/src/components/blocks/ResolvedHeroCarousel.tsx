/**
 * ResolvedHeroCarousel
 *
 * Wraps HeroCarousel with post-resolution. A carousel's items may include
 * 'posts' items (a saved post query). This component expands each 'posts'
 * item into ONE media-style slide per resolved post — using the post's
 * banner image (`featuredImage`) as the backdrop and its title as the
 * overlay heading, linking to the post — then hands the flattened item
 * list to the presentational HeroCarousel.
 *
 * Resolution rules per posts item (mirrors the post_list block):
 *   - Specific posts (pinnedPostIds) first, in order.
 *   - Then query results (count / date window / search), deduped.
 *   - Zero posts + showEmptyMessage → a single "No posts found" slide.
 *   - Zero posts + !showEmptyMessage → no slide.
 *
 * Media items pass through untouched. When a carousel has NO posts
 * items, resolution is skipped entirely (no async, no flicker).
 */
import type { HeroCarouselOptions, HeroItem, HeroPostsConfig, } from '@sitesurge/types';
import { Component, createMemo, createResource, } from 'solid-js';
import { fetchPostList, type PostWithBlocks, } from '../../services/postsService';
import HeroCarousel from './HeroCarousel';

export interface ResolvedHeroCarouselProps {
    items: HeroItem[];
    options: HeroCarouselOptions;
    height?: string;
    previewMode?: boolean;
    gutterWidth?: string;
}

/** Map a resolved post to a media-style hero slide. */
function postToSlide(carouselItemId: string, post: PostWithBlocks, order: number,): HeroItem {
    const hasImage = !!post.featuredImage;
    return {
        id: `${carouselItemId}:${(post as any).id}`,
        type: 'media',
        // Omit mediaType when there's no banner image so HeroCarousel
        // renders no <img> (avoids an empty-src request); the title
        // overlay still shows on the slide background.
        mediaType: hasImage ? 'image' : undefined,
        mediaUrl: hasImage ? post.featuredImage! : undefined,
        mediaThumbnailUrl: hasImage ? post.featuredImage! : undefined,
        objectFit: 'cover',
        header: { text: post.title, size: 'h1', color: '#ffffff', },
        action: post.slug
            ? { label: 'Read More', url: `/posts/${post.slug}`, openInNewTab: false, size: 'small', }
            : undefined,
        order,
    };
}

function emptySlide(carouselItemId: string,): HeroItem {
    return {
        id: `${carouselItemId}:empty`,
        type: 'media',
        header: { text: 'No posts found', size: 'h3', color: '#ffffff', },
        order: 0,
    };
}

/** Resolve a single 'posts' item into its slides (may be empty). */
async function resolvePostsItem(item: HeroItem,): Promise<HeroItem[]> {
    const cfg: HeroPostsConfig = item.posts ?? {};
    const pinnedIds = cfg.pinnedPostIds ?? [];
    const queryEnabled = cfg.queryEnabled !== false;
    const showEmpty = cfg.showEmptyMessage !== false;

    const pinned = pinnedIds.length
        ? (await fetchPostList({ count: pinnedIds.length, ids: pinnedIds, })).posts
        : [];
    const query = queryEnabled
        ? (await fetchPostList({
            count: cfg.count ?? 5,
            afterDaysAgo: cfg.afterDaysAgo,
            beforeDaysAgo: cfg.beforeDaysAgo,
            search: cfg.query,
        })).posts
        : [];

    const seen = new Set(pinned.map(p => (p as any).id as string),);
    const combined = [...pinned, ...query.filter(p => !seen.has((p as any).id as string,)),];

    if (combined.length === 0) return showEmpty ? [emptySlide(item.id,),] : [];
    return combined.map((p, i,) => postToSlide(item.id, p, i,));
}

const ResolvedHeroCarousel: Component<ResolvedHeroCarouselProps> = (props,) => {
    const hasPostsItems = createMemo(() => props.items.some(i => i.type === 'posts'),);

    // Key the resource on a serialization of items so admin edits (new
    // array each keystroke) re-resolve, but identical configs don't
    // refetch (fetchPostList also caches by query hash).
    const [resolved,] = createResource(
        () => hasPostsItems() ? JSON.stringify(props.items,) : null,
        async () => {
            const out: HeroItem[] = [];
            for (const item of props.items) {
                if (item.type === 'posts') out.push(...await resolvePostsItem(item,),);
                else out.push(item,);
            }
            return out.map((it, i,) => ({ ...it, order: i, }));
        },
    );

    const finalItems = createMemo(() => {
        if (!hasPostsItems()) return props.items;
        // While (re)resolving, keep the last resolved list to avoid a
        // flash; before the first resolve, show media items only.
        return resolved.latest ?? props.items.filter(i => i.type !== 'posts');
    },);

    return (
        <HeroCarousel
            items={finalItems()}
            options={props.options}
            height={props.height}
            previewMode={props.previewMode}
            gutterWidth={props.gutterWidth}
        />
    );
};

export default ResolvedHeroCarousel;
