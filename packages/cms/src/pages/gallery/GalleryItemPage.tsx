/**
 * One gallery item (`/gallery/:id`, or `<base>/:id`): the media large (image,
 * or the video in our player), title, caption, credits, previous / next in
 * its listing (the item's collection, else the gallery root), the published date (Appearance → "Show date published"), and the item's comments (`gallery_item:<id>` — whether
 * commenting is open, and for guests, follows the item's settings).
 *
 * In a collection, the nav links back to the collection AND the gallery, and
 * with "Show collections sidebar" on the collections sidebar sits beside it —
 * its top link then reads "← Gallery" and the nav drops its own gallery link.
 * With "Show the collection's other items" on, the collection's items are a
 * thumbnail column on the right (desktop, sticky + scrollable) or a
 * horizontal strip under the media, before the comments (mobile).
 *
 * Missing or deleted media → the API 404s → the 404 page. An existing item
 * this viewer may not see (its rule, its collection's, or the whole gallery)
 * → 403 → the access-denied fallback (`utils/accessDenied`: the login page
 * with the reason, returning here after signing in).
 */
import { formatDate, type GalleryCollection, type GalleryItem, type GalleryPublicConfig, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, type RouteSectionProps, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, For, Show, } from 'solid-js';
import MediaVideo from '../../components/blocks/media/MediaVideo';
import SeoHead from '../../components/common/seo/SeoHead';
import UpgradeTout from '../../components/content/UpgradeTout';
import CommentsSection from '../../components/discussions/CommentsSection';
import { baseSlug, loadGalleryRoute, } from '../../components/gallery/galleryConfig';
import { pageStyle, } from '../../components/gallery/galleryLayout';
import { tileSrc, } from '../../components/gallery/GalleryTile';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import { deniedReasonOf, handleAccessDenied, } from '../../utils/accessDenied';
import NotFoundPage from '../NotFound';
import { GalleryCollectionsLayout, visibleCollections, } from './GalleryCollections';
import './gallery.scss';

/** Intersected with the router's section props so it stays a valid <Route component> (see DynamicPageProps). */
export type GalleryItemPageProps = Partial<RouteSectionProps> & { id?: string; };

const GalleryItemPage: Component<GalleryItemPageProps> = (props,) => {
    const params = useParams<{ id?: string; }>();
    const auth = useAuth();
    const navigate = useNavigate();
    const id = () => props.id ?? params.id ?? '';
    const key = () => `${id()}:${auth.user?.id ?? 'anon'}`;

    const [data, { refetch, },] = createResource(key, async () => {
        let denied: ReturnType<typeof deniedReasonOf> = null;
        if (!isFeatureEnabled('gallery',)) return { config: null, item: null, denied, };
        const [config, item,] = await Promise.all([
            cms.gallery.config().catch(() => null as GalleryPublicConfig | null),
            cms.gallery.item(id(),).catch((err,) => {
                denied = deniedReasonOf(err, Boolean(auth.user,),);
                return null as GalleryItem | null;
            }),
        ],);
        return { config, item, denied: denied as ReturnType<typeof deniedReasonOf>, };
    },);

    // Exists but not for this viewer (403 from the API): the access-denied
    // fallback (login page + reason). Waits for the session check so a
    // signed-in visitor is never sent to sign in. Missing → the 404 below.
    createEffect(() => {
        const d = data();
        if (!d?.denied || data.loading || auth.isLoading) return;
        handleAccessDenied(navigate, d.denied.reason, { tierName: d.denied.tierName, },);
    },);

    // Neighbours within the item's listing — its collection, else the gallery
    // root (= every item when no collections exist), as the gallery pages list it (`listing`: an item
    // hidden from the gallery has no neighbours). One list read; fine for typical galleries.
    const [neighbours,] = createResource(
        () => (data()?.item ? key() : null),
        async () => {
            const r = await cms.gallery.list({ collectionId: data()?.item?.collectionId ?? 'root', listing: true, limit: 200, },).catch(() => null);
            const list = r?.items ?? [];
            const i = list.findIndex((x,) => x.id === id(),);
            return { list, ...(i < 0 ? { prev: null, next: null, } : { prev: list[i - 1] ?? null, next: list[i + 1] ?? null, }), };
        },
    );

    const back = () => data()?.config?.baseUrl || '/gallery';
    const sidebarOn = (config: GalleryPublicConfig | null | undefined, item: GalleryItem,) =>
        Boolean(config?.appearance.showCollectionsSidebar && item.collectionId,);
    /** The collection's items for the thumbnail column (setting on + the item is in a collection). */
    const stripItems = (): GalleryItem[] => {
        const d = data();
        if (!d?.config?.appearance.showCollectionItems || !d.item?.collectionId) return [];
        return (neighbours()?.list ?? []).filter((x,) => x.media,);
    };

    // Collections: the back link's name (incl. a collection hidden from the gallery) and the sidebar
    // (`visibleCollections` drops hidden ones). Only read for an item in a collection.
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
                        <Show when={!d().denied && d().config && !d().config!.canView} fallback={<Show when={!d().denied}><NotFoundPage /></Show>}>
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
                                enabled={sidebarOn(d().config, item(),)}
                                collections={visibleCollections(collections(),)}
                                currentId={item().collectionId ?? ''}
                                baseUrl={back()}
                                allLabel={`← ${d().config?.title || 'Gallery'}`}
                            >
                                <div class="gallery-item-page__body" classList={{ 'has-strip': stripItems().length > 1, }}>
                                <div class="gallery-item-page__main">
                                <nav class="gallery-item-page__nav">
                                    <span class="gallery-item-page__back">
                                        <Show when={collection()}>{(c,) => <A href={c().url}>← {c().name}</A>}</Show>
                                        {/* The collections sidebar carries the gallery link. */}
                                        <Show when={!(sidebarOn(d().config, item(),) && visibleCollections(collections(),).length > 0)}>
                                            <A href={back()}>← {d().config?.title || 'Gallery'}</A>
                                        </Show>
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
                                </div>
                                {/* The collection's items: a right column (desktop) / a strip under the media (mobile). */}
                                <Show when={stripItems().length > 1}>
                                    <aside class="gallery-item-page__strip" aria-label={collection() ? `More in ${collection()!.name}` : 'More in this collection'}>
                                        <Show when={collection()}>{(c,) => <h2 class="gallery-item-page__strip-heading"><A href={c().url}>{c().name}</A></h2>}</Show>
                                        <div class="gallery-item-page__strip-list">
                                            <For each={stripItems()}>
                                                {(it,) => (
                                                    <A
                                                        href={it.url}
                                                        class="gallery-item-page__strip-item"
                                                        classList={{ 'is-active': it.id === item().id, }}
                                                        aria-current={it.id === item().id ? 'page' : undefined}
                                                        title={it.title || undefined}
                                                    >
                                                        <img src={tileSrc(it,)} alt={it.media?.alt || it.title || ''} loading="lazy" />
                                                        <Show when={it.media?.type === 'video'}><span class="gallery-item-page__strip-play" aria-hidden="true">▶</span></Show>
                                                    </A>
                                                )}
                                            </For>
                                        </div>
                                    </aside>
                                </Show>
                                <Show when={isFeatureEnabled('comments',)}>
                                    <div class="gallery-item-page__comments-wrap">
                                        <CommentsSection targetType="gallery_item" targetId={item().id} class="gallery-item-page__comments" />
                                    </div>
                                </Show>
                                </div>
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
