/**
 * The public gallery page (`/gallery`, or the configured base URL via
 * DynamicPage). Gated by the gallery's access rule: a signed-out visitor gets
 * an in-page log-in, a member without the tier a subscribe prompt. Items load
 * a page at a time (appearance.perPage) with "Load more", laid out per the
 * Appearance settings through the shared GalleryView.
 *
 * When the viewer can see at least one collection, a "Collections" section
 * sits on top and the listing shows only the ROOT items (in no collection);
 * with none, every item is listed, exactly as before collections existed.
 */
import type { GalleryCollection, GalleryPublicConfig, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { Component, createResource, Show, } from 'solid-js';
import Markdown from '../../components/common/Markdown';
import SeoHead from '../../components/common/seo/SeoHead';
import UpgradeTout from '../../components/content/UpgradeTout';
import { appearanceToView, pageStyle, } from '../../components/gallery/galleryLayout';
import GalleryView from '../../components/gallery/GalleryView';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import NotFoundPage from '../NotFound';
import { GalleryCollectionCards, visibleCollections, } from './GalleryCollections';
import './gallery.scss';
import { useGalleryItems, } from './useGalleryItems';

const GalleryPage: Component = () => {
    const auth = useAuth();
    const viewerKey = () => auth.user?.id ?? 'anon';
    const [config, { refetch: refetchConfig, },] = createResource(viewerKey, () =>
        isFeatureEnabled('gallery',) ? cms.gallery.config().catch(() => null as GalleryPublicConfig | null) : Promise.resolve(null,),);

    const perPage = () => config()?.appearance.perPage ?? 24;

    // Collections first: whether any exist decides which items the listing shows.
    const [collections, { refetch: refetchCollections, },] = createResource(
        () => (config()?.canView ? viewerKey() : null),
        () => cms.gallery.collections({ listing: true, },).catch(() => [] as GalleryCollection[]),
    );
    const shownCollections = () => visibleCollections(collections(),);

    const list = useGalleryItems(
        () => (config()?.canView && collections() !== undefined ? `${viewerKey()}:${perPage()}:${shownCollections().length > 0}` : null),
        () => (shownCollections().length > 0 ? { collectionId: 'root', } : {}),
        perPage,
    );

    const onLoggedIn = () => {
        void refetchConfig();
        void refetchCollections();
        void list.refetch();
    };

    return (
        <Show when={config() !== undefined} fallback={<div class="gallery-page page-wrapper"><p class="gallery-page__loading">Loading…</p></div>}>
            <Show when={config()} fallback={<NotFoundPage />}>
                {(cfg,) => (
                    <div class={`gallery-page page-wrapper gallery-page--${cfg().appearance.layout}`} style={pageStyle(cfg().appearance,)}>
                        <Title>{cfg().title || 'Gallery'}</Title>
                        <SeoHead title={cfg().title || 'Gallery'} description={cfg().description || undefined} />
                        <header class="gallery-page__head">
                            <h1>{cfg().title || 'Gallery'}</h1>
                            <Show when={cfg().description}>
                                <Markdown text={cfg().description} class="gallery-page__intro" />
                            </Show>
                        </header>
                        <Show
                            when={cfg().canView}
                            fallback={
                                <UpgradeTout
                                    class="gallery-page__gate"
                                    requiredTier={cfg().requiredTier}
                                    title={cfg().reason === 'signin' ? 'Members only' : 'Members-only gallery'}
                                    message={cfg().reason === 'signin'
                                        ? 'Log in or create an account to view the gallery.'
                                        : cfg().requiredTier
                                        ? <>The gallery is for <strong>{cfg().requiredTier!.name}</strong> members.</>
                                        : 'The gallery requires a membership.'}
                                    onLoggedIn={onLoggedIn}
                                />
                            }
                        >
                            <Show when={list.loaded()} fallback={<p class="gallery-page__loading">Loading…</p>}>
                                <Show when={shownCollections().length > 0}>
                                    <GalleryCollectionCards collections={shownCollections()} />
                                </Show>
                                <GalleryView
                                    items={list.items()}
                                    settings={appearanceToView(cfg().appearance,)}
                                    thumbSize={cfg().appearance.thumbSize}
                                    hoverZoom={cfg().appearance.hoverZoom}
                                    videoBadge={cfg().appearance.videoBadge}
                                    empty={shownCollections().length > 0 ? undefined : 'Nothing here yet.'}
                                />
                                <Show when={list.hasMore()}>
                                    <div class="gallery-page__more">
                                        <button type="button" class="btn" disabled={list.loadingMore()} onClick={() => void list.loadMore()}>
                                            {list.loadingMore() ? 'Loading…' : 'Load more'}
                                        </button>
                                    </div>
                                </Show>
                            </Show>
                        </Show>
                    </div>
                )}
            </Show>
        </Show>
    );
};

export default GalleryPage;
