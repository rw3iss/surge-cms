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
import type {
    Block,
    EntityRecord,
    HeroCarouselOptions,
    HeroItem,
    HeroPostMeta,
    HeroPostsConfig,
} from '@sitesurge/types';
import { buildBlockTree, } from '@sitesurge/types';
import { Component, createMemo, createResource, type JSX, } from 'solid-js';
import { mapTemplateBlocks, resolveRecords, type TplEntities, } from '../../services/entityBinding';
import { fetchPostList, type PostWithBlocks, } from '../../services/postsService';
import { cms, } from '../../services/cmsClient';
import HeroCarousel, { type HeroSlide, } from './HeroCarousel';

/** Args passed to the injected entity-slide renderer. Kept as an interface so the
 *  caller (which owns `BlockRenderer`) supplies the JSX — this module stays free
 *  of a `BlockRenderer` import, avoiding an import cycle. */
export interface RenderEntitySlideArgs {
    roots: Block[];
    entityType: string;
    record: EntityRecord;
    ctx?: TplEntities;
}

export interface ResolvedHeroCarouselProps {
    items: HeroItem[];
    options: HeroCarouselOptions;
    height?: string;
    previewMode?: boolean;
    gutterWidth?: string;
    /** Block-style alignment (textAlign / verticalAlign) forwarded to slides. */
    align?: string;
    valign?: string;
    /** Block-style padding — insets slide text content, not the media. */
    contentPadding?: string;
    /** Block-style margin — applied to the slide text content. */
    contentMargin?: string;
    /** Block-style background color/gradient, applied per slide (overlay on a
     *  media backdrop, or the slide's own background when there's no media). */
    itemBackground?: string;
    /** Route/context entity bag, for entity items bound with `mode: 'context'`. */
    ctx?: TplEntities;
    /** Injected renderer for an entity item's slide (its template rendered with
     *  the record bound). Supplied by callers that own `BlockRenderer`. Without
     *  it, entity items are skipped. */
    renderEntitySlide?: (args: RenderEntitySlideArgs,) => JSX.Element;
}

/** A resolved entity slide, described as DATA in the async pass; the actual JSX
 *  is built later (inside the component's reactive owner) via `renderEntitySlide`
 *  so its effects are owned/disposed correctly. */
interface EntitySlideDescriptor {
    __entity: true;
    id: string;
    entityType: string;
    roots: Block[];
    record: EntityRecord;
    order: number;
}
type ResolvedDescriptor = HeroItem | EntitySlideDescriptor;
const isEntityDescriptor = (d: ResolvedDescriptor,): d is EntitySlideDescriptor =>
    (d as EntitySlideDescriptor).__entity === true;

/** Resolve a single 'entity' item into one descriptor per bound record. */
async function resolveEntityItem(item: HeroItem, ctx: TplEntities | undefined,): Promise<EntitySlideDescriptor[]> {
    const cfg = item.entity;
    if (!cfg?.entityType || !cfg.templateId) return [];
    const tpl = await cms.contentBlockTemplates.getOne(cfg.entityType, cfg.templateId,).catch(() => null);
    if (!tpl) return [];
    const roots = buildBlockTree(mapTemplateBlocks(tpl.blocks ?? [],),);
    const records = await resolveRecords(cfg.entityType, cfg.binding, tpl.maxRecords, ctx,);
    return records.map((record, i,) => ({
        __entity: true as const,
        id: `${item.id}:${String(record.id ?? i)}`,
        entityType: cfg.entityType,
        roots,
        record,
        order: i,
    }));
}

/** Build the show-fields overlay metadata for a slide (only the fields
 *  the operator enabled; `undefined` when none apply). */
function buildPostMeta(cfg: HeroPostsConfig, post: PostWithBlocks,): HeroPostMeta | undefined {
    const meta: HeroPostMeta = {};
    if (cfg.showAuthor && post.author) meta.author = post.author;
    if (cfg.showExcerpt && post.excerpt) meta.excerpt = post.excerpt;
    if (cfg.showDateCreated && (post.publishedAt || post.createdAt)) {
        meta.dateCreated = String(post.publishedAt || post.createdAt,);
    }
    if (cfg.showDateUpdated && post.updatedAt) meta.dateUpdated = String(post.updatedAt,);
    if (cfg.showTags && post.tags?.length) meta.tags = post.tags;
    return (meta.author || meta.excerpt || meta.dateCreated || meta.dateUpdated || meta.tags) ? meta : undefined;
}

/** Map a resolved post to a media-style hero slide. */
function postToSlide(cfg: HeroPostsConfig, post: PostWithBlocks, order: number, carouselItemId: string,): HeroItem {
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
        header: { text: post.title, size: 'h2', color: '#ffffff', },
        postMeta: buildPostMeta(cfg, post,),
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
    return combined.map((p, i,) => postToSlide(cfg, p, i, item.id,));
}

const ResolvedHeroCarousel: Component<ResolvedHeroCarouselProps> = (props,) => {
    // 'posts' and 'entity' items need an async resolution pass; plain media
    // items don't (no async, no flicker when a carousel has none).
    const hasDynamic = createMemo(() => props.items.some(i => i.type === 'posts' || i.type === 'entity'),);

    // Key the resource on a serialization of items so admin edits (new
    // array each keystroke) re-resolve, but identical configs don't
    // refetch (fetchPostList also caches by query hash).
    const [resolved,] = createResource(
        () => hasDynamic() ? JSON.stringify(props.items,) : null,
        async () => {
            const out: ResolvedDescriptor[] = [];
            for (const item of props.items) {
                if (item.type === 'posts') out.push(...await resolvePostsItem(item,),);
                else if (item.type === 'entity') out.push(...await resolveEntityItem(item, props.ctx,),);
                else out.push(item,);
            }
            return out;
        },
    );

    // Map resolved descriptors → HeroSlide[]. Entity descriptors get their JSX
    // built HERE (inside the reactive owner), not in the async fetcher, so the
    // rendered template's effects are owned and disposed correctly.
    const finalItems = createMemo<HeroSlide[]>(() => {
        const descriptors: ResolvedDescriptor[] = hasDynamic()
            // While (re)resolving, keep the last resolved list to avoid a flash;
            // before the first resolve, show plain media items only.
            ? (resolved.latest ?? props.items.filter(i => i.type !== 'posts' && i.type !== 'entity'))
            : props.items;
        return descriptors.map((d, i,): HeroSlide => {
            if (isEntityDescriptor(d)) {
                return {
                    id: d.id,
                    type: 'entity',
                    order: i,
                    contentNode: props.renderEntitySlide?.({
                        roots: d.roots,
                        entityType: d.entityType,
                        record: d.record,
                        ctx: props.ctx,
                    },),
                };
            }
            return { ...d, order: i, };
        },);
    },);

    return (
        <HeroCarousel
            items={finalItems()}
            options={props.options}
            height={props.height}
            previewMode={props.previewMode}
            gutterWidth={props.gutterWidth}
            align={props.align}
            valign={props.valign}
            contentPadding={props.contentPadding}
            contentMargin={props.contentMargin}
            itemBackground={props.itemBackground}
        />
    );
};

export default ResolvedHeroCarousel;
