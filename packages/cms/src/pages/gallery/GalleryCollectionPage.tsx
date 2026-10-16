/**
 * One gallery collection (`/gallery/collection/:id`, or `<base>/collection/:id`):
 * title, description and the collection's items through the shared
 * GalleryView, with the gallery's open action (modal — whose thumbnail strip
 * and arrows then cover this collection only — or the item page). A
 * "← <gallery>" link goes back; with "Show collections sidebar" on, the
 * collections sidebar sits beside it.
 *
 * A missing collection, or one this viewer fails the access rule of, 404s
 * from the API → the 404 page. When the whole gallery is closed to the viewer
 * the gallery's gate is shown instead. SSR serves the server-side meta
 * (404 / noindex); the SPA head mirrors it.
 */
import { type GalleryCollection, type GalleryPublicConfig, isGalleryAccessRuleActive, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, type RouteSectionProps, useParams, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import Markdown from '../../components/common/Markdown';
import SeoHead from '../../components/common/seo/SeoHead';
import UpgradeTout from '../../components/content/UpgradeTout';
import { baseSlug, loadGalleryRoute, } from '../../components/gallery/galleryConfig';
import { appearanceToView, pageStyle, } from '../../components/gallery/galleryLayout';
import GalleryView from '../../components/gallery/GalleryView';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import NotFoundPage from '../NotFound';
import { GalleryCollectionsLayout, visibleCollections, } from './GalleryCollections';
import './gallery.scss';
import { useGalleryItems, } from './useGalleryItems';

/** Intersected with the router's section props so it stays a valid <Route component>. */
export type GalleryCollectionPageProps = Partial<RouteSectionProps> & { id?: string; };

const GalleryCollectionPage: Component<GalleryCollectionPageProps> = (props,) => {
    const params = useParams<{ id?: string; }>();
    const auth = useAuth();
    const id = () => props.id ?? params.id ?? '';
    const key = () => `${id()}:${auth.user?.id ?? 'anon'}`;

    const [data, { refetch, },] = createResource(key, async () => {
        if (!isFeatureEnabled('gallery',)) return { config: null, collection: null, };
        const [config, collection,] = await Promise.all([
            cms.gallery.config().catch(() => null as GalleryPublicConfig | null),
            cms.gallery.collection(id(),).catch(() => null as GalleryCollection | null),
        ],);
        return { config, collection, };
    },);

    const appearance = () => data()?.config?.appearance;
    const perPage = () => appearance()?.perPage ?? 24;

    // The sidebar's list — only fetched when the setting is on.
    const [collections,] = createResource(
        () => (data()?.collection && appearance()?.showCollectionsSidebar ? key() : null),
        () => cms.gallery.collections().catch(() => [] as GalleryCollection[]),
    );

    const list = useGalleryItems(
        () => (data()?.collection ? `${key()}:${perPage()}` : null),
        () => ({ collectionId: id(), }),
        perPage,
    );

    const galleryTitle = () => data()?.config?.title || 'Gallery';
    const back = () => data()?.config?.baseUrl || '/gallery';

    return (
        <Show when={data()} fallback={<div class="gallery-page page-wrapper"><p class="gallery-page__loading">Loading…</p></div>}>
            {(d,) => (
                <Show
                    when={d().collection}
                    fallback={
                        <Show when={d().config && !d().config!.canView} fallback={<NotFoundPage />}>
                            <div class="gallery-page page-wrapper" style={pageStyle(d().config!.appearance,)}>
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
                    {(c,) => (
                        <div
                            class={`gallery-page gallery-collection-page page-wrapper gallery-page--${appearance()?.layout ?? 'grid'}`}
                            style={appearance() ? pageStyle(appearance()!,) : undefined}
                        >
                            <Title>{`${c().name} | ${galleryTitle()}`}</Title>
                            <SeoHead
                                title={`${c().name} | ${galleryTitle()}`}
                                description={c().description || undefined}
                                image={c().coverThumbnailUrl || undefined}
                                // Restricted collections are never indexable (anonymous fails an active rule); the SSR head decides the rest.
                                noindex={isGalleryAccessRuleActive(c().access,)}
                            />
                            <GalleryCollectionsLayout
                                enabled={Boolean(appearance()?.showCollectionsSidebar,)}
                                collections={visibleCollections(collections(),)}
                                currentId={c().id}
                                baseUrl={back()}
                            >
                                <nav class="gallery-item-page__nav">
                                    <A href={back()}>← {galleryTitle()}</A>
                                </nav>
                                <header class="gallery-page__head">
                                    <h1>{c().name}</h1>
                                    <Show when={c().description}>
                                        <Markdown text={c().description} class="gallery-page__intro" />
                                    </Show>
                                </header>
                                <Show when={list.loaded()} fallback={<p class="gallery-page__loading">Loading…</p>}>
                                    <Show when={appearance()}>
                                        {(a,) => (
                                            <GalleryView
                                                items={list.items()}
                                                settings={appearanceToView(a(),)}
                                                thumbSize={a().thumbSize}
                                                hoverZoom={a().hoverZoom}
                                                videoBadge={a().videoBadge}
                                                empty="Nothing here yet."
                                            />
                                        )}
                                    </Show>
                                    <Show when={list.hasMore()}>
                                        <div class="gallery-page__more">
                                            <button type="button" class="btn" disabled={list.loadingMore()} onClick={() => void list.loadMore()}>
                                                {list.loadingMore() ? 'Loading…' : 'Load more'}
                                            </button>
                                        </div>
                                    </Show>
                                </Show>
                            </GalleryCollectionsLayout>
                        </div>
                    )}
                </Show>
            )}
        </Show>
    );
};

export default GalleryCollectionPage;

/**
 * `/<custom base>/collection/:id` — for a gallery whose base URL is not
 * /gallery. Renders the collection page when the first segment is the
 * configured base, else the 404.
 */
export const GalleryCustomCollectionRoute: Component = () => {
    const params = useParams<{ slug?: string; id?: string; }>();
    const [route,] = createResource(() => loadGalleryRoute(),);
    return (
        <Show when={route() !== undefined}>
            <Show when={route() && baseSlug(route()!.baseUrl,) === (params.slug ?? '').toLowerCase()} fallback={<NotFoundPage />}>
                <GalleryCollectionPage id={params.id} />
            </Show>
        </Show>
    );
};
