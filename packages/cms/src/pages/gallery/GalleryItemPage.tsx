/**
 * One gallery item (`/gallery/:id`, or `<base>/:id`): the media large (image,
 * or the video in our player), title, caption, credits, previous / next in
 * its listing (the item's collection, else the gallery root), the published date (Appearance → "Show date published"), and the item's comments (`gallery_item:<id>` — whether
 * commenting is open, and for guests, follows the item's settings).
 *
 * In a collection, the nav links back to the collection AND the gallery, and
 * with "Show collections sidebar" on the collections sidebar sits beside it.
 *
 * Missing, deleted media, or hidden from this viewer → the API 404s; when the
 * whole gallery is closed to the viewer the gallery's gate is shown instead.
 */
import { formatDate, type GalleryCollection, type GalleryItem, type GalleryPublicConfig, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, type RouteSectionProps, useParams, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import MediaVideo from '../../components/blocks/media/MediaVideo';
import SeoHead from '../../components/common/seo/SeoHead';
import UpgradeTout from '../../components/content/UpgradeTout';
import CommentsSection from '../../components/discussions/CommentsSection';
import { baseSlug, loadGalleryRoute, } from '../../components/gallery/galleryConfig';
import { pageStyle, } from '../../components/gallery/galleryLayout';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import NotFoundPage from '../NotFound';
import { GalleryCollectionsLayout, visibleCollections, } from './GalleryCollections';
import './gallery.scss';

/** Intersected with the router's section props so it stays a valid <Route component> (see DynamicPageProps). */
export type GalleryItemPageProps = Partial<RouteSectionProps> & { id?: string; };

const GalleryItemPage: Component<GalleryItemPageProps> = (props,) => {
    const params = useParams<{ id?: string; }>();
    const auth = useAuth();
    const id = () => props.id ?? params.id ?? '';
    const key = () => `${id()}:${auth.user?.id ?? 'anon'}`;

    const [data, { refetch, },] = createResource(key, async () => {
        if (!isFeatureEnabled('gallery',)) return { config: null, item: null, };
        const [config, item,] = await Promise.all([
            cms.gallery.config().catch(() => null as GalleryPublicConfig | null),
            cms.gallery.item(id(),).catch(() => null as GalleryItem | null),
        ],);
        return { config, item, };
    },);

    // Neighbours within the item's listing — its collection, else the gallery
    // root (= every item when no collections exist). One list read; fine for typical galleries.
    const [neighbours,] = createResource(
        () => (data()?.item ? key() : null),
        async () => {
            const r = await cms.gallery.list({ collectionId: data()?.item?.collectionId ?? 'root', limit: 200, },).catch(() => null);
            const list = r?.items ?? [];
            const i = list.findIndex((x,) => x.id === id(),);
            return i < 0 ? { prev: null, next: null, } : { prev: list[i - 1] ?? null, next: list[i + 1] ?? null, };
        },
    );

    const back = () => data()?.config?.baseUrl || '/gallery';

    // Collections: the back link's name and the sidebar. Only read for an item in a collection.
    const [collections,] = createResource(
        () => (data()?.item?.collectionId ? key() : null),
        () => cms.gallery.collections().catch(() => [] as GalleryCollection[]),
    );
    const collection = () => {
        const cid = data()?.item?.collectionId;
        return cid ? (collections() ?? []).find((c,) => c.id === cid,) ?? null : null;
    };

    return (
        <Show when={data()} fallback={<div class="gallery-item-page page-wrapper"><p class="gallery-page__loading">Loading…</p></div>}>
            {(d,) => (
                <Show
                    when={d().item}
                    fallback={
                        <Show when={d().config && !d().config!.canView} fallback={<NotFoundPage />}>
                            <div class="gallery-item-page page-wrapper" style={pageStyle(d().config!.appearance,)}>
                                <UpgradeTout
                                    requiredTier={d().config!.requiredTier}
                                    title={d().config!.reason === 'signin' ? 'Members only' : 'Members-only gallery'}
                                    message={d().config!.reason === 'signin' ? 'Log in or create an account to view this.' : 'This is for members.'}
                                    onLoggedIn={() => void refetch()}
                                />
                            </div>
                        </Show>
                    }
                >
                    {(item,) => (
                        <div class="gallery-item-page page-wrapper" style={d().config ? pageStyle(d().config!.appearance,) : undefined}>
                            <Title>{item().title || d().config?.title || 'Gallery'}</Title>
                            <SeoHead
                                title={item().title || d().config?.title || 'Gallery'}
                                description={item().caption || undefined}
                                image={item().media?.type === 'image' ? item().media?.url : item().media?.thumbnailUrl || undefined}
                                imageAlt={item().media?.alt || undefined}
                            />
                            <GalleryCollectionsLayout
                                enabled={Boolean(d().config?.appearance.showCollectionsSidebar && item().collectionId,)}
                                collections={visibleCollections(collections(),)}
                                currentId={item().collectionId ?? ''}
                                baseUrl={back()}
                            >
                                <nav class="gallery-item-page__nav">
                                    <span class="gallery-item-page__back">
                                        <Show when={collection()}>{(c,) => <A href={c().url}>← {c().name}</A>}</Show>
                                        <A href={back()}>← {d().config?.title || 'Gallery'}</A>
                                    </span>
                                    <span class="gallery-item-page__pn">
                                        <Show when={neighbours()?.prev}>{(p,) => <A href={p().url} rel="prev">‹ Previous</A>}</Show>
                                        <Show when={neighbours()?.next}>{(n,) => <A href={n().url} rel="next">Next ›</A>}</Show>
                                    </span>
                                </nav>
                                <Show when={item().title}><h1 class="gallery-item-page__title">{item().title}</h1></Show>
                                <figure class="gallery-item-page__figure">
                                    <Show
                                        when={item().media?.type === 'video'}
                                        fallback={<img src={item().media?.url} alt={item().media?.alt || item().title || ''} />}
                                    >
                                        <Show when={item().media!.id} keyed>
                                            {(mid,) => <MediaVideo mediaId={mid} showQualityMenu fallbackSrc={item().media?.url} />}
                                        </Show>
                                    </Show>
                                    <figcaption class="gallery-item-page__meta">
                                        <Show when={item().caption}><p class="gallery-item-page__caption">{item().caption}</p></Show>
                                        <Show when={d().config?.appearance.showPublishedDate && item().publishedAt}>
                                            <p class="gallery-item-page__date">
                                                <time datetime={item().publishedAt}>{formatDate(item().publishedAt, { month: 'long', },)}</time>
                                            </p>
                                        </Show>
                                        <Show when={item().media?.credits}><p class="gallery-item-page__credits">{item().media!.credits}</p></Show>
                                        <Show when={item().tags.length}>
                                            <p class="gallery-item-page__tags">
                                                {item().tags.map((t,) => <span class="gallery-item-page__tag">#{t}</span>)}
                                            </p>
                                        </Show>
                                    </figcaption>
                                </figure>
                                <Show when={isFeatureEnabled('comments',)}>
                                    <CommentsSection targetType="gallery_item" targetId={item().id} class="gallery-item-page__comments" />
                                </Show>
                            </GalleryCollectionsLayout>
                        </div>
                    )}
                </Show>
            )}
        </Show>
    );
};

export default GalleryItemPage;

/**
 * `/<custom base>/:id` — for a gallery whose base URL is not /gallery. Renders
 * the item page when the first segment is the configured base, else the 404.
 * Wire as `<Route path="/:slug/:id" component={GalleryCustomItemRoute} />`.
 */
export const GalleryCustomItemRoute: Component = () => {
    const params = useParams<{ slug?: string; id?: string; }>();
    const [route,] = createResource(() => loadGalleryRoute(),);
    return (
        <Show when={route() !== undefined}>
            <Show when={route() && baseSlug(route()!.baseUrl,) === (params.slug ?? '').toLowerCase()} fallback={<NotFoundPage />}>
                <GalleryItemPage id={params.id} />
            </Show>
        </Show>
    );
};
