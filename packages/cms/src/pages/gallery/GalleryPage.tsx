/**
 * The public gallery page (`/gallery`, or the configured base URL via
 * DynamicPage). Gated by the gallery's access rule: a signed-out visitor gets
 * an in-page log-in, a member without the tier a subscribe prompt. Items load
 * a page at a time (appearance.perPage) with "Load more", laid out per the
 * Appearance settings through the shared GalleryView.
 */
import type { GalleryItem, GalleryPublicConfig, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { Component, createResource, createSignal, Show, } from 'solid-js';
import Markdown from '../../components/common/Markdown';
import SeoHead from '../../components/common/seo/SeoHead';
import UpgradeTout from '../../components/content/UpgradeTout';
import { appearanceToView, pageStyle, } from '../../components/gallery/galleryLayout';
import GalleryView from '../../components/gallery/GalleryView';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import NotFoundPage from '../NotFound';
import './gallery.scss';

const GalleryPage: Component = () => {
    const auth = useAuth();
    const viewerKey = () => auth.user?.id ?? 'anon';
    const [config, { refetch: refetchConfig, },] = createResource(viewerKey, () =>
        isFeatureEnabled('gallery',) ? cms.gallery.config().catch(() => null as GalleryPublicConfig | null) : Promise.resolve(null,),);

    const [items, setItems,] = createSignal<GalleryItem[]>([],);
    const [total, setTotal,] = createSignal(0,);
    const [page, setPage,] = createSignal(1,);
    const [loadingMore, setLoadingMore,] = createSignal(false,);
    const perPage = () => config()?.appearance.perPage ?? 24;

    const [firstPage, { refetch: refetchItems, },] = createResource(
        () => (config()?.canView ? `${viewerKey()}:${perPage()}` : null),
        async () => {
            const r = await cms.gallery.list({ limit: perPage(), page: 1, },).catch(() => null);
            setItems(r?.items ?? [],);
            setTotal(r?.total ?? 0,);
            setPage(1,);
            return true;
        },
    );

    const loadMore = async () => {
        setLoadingMore(true,);
        try {
            const r = await cms.gallery.list({ limit: perPage(), page: page() + 1, },);
            setItems((cur,) => [...cur, ...r.items,],);
            setTotal(r.total,);
            setPage((p,) => p + 1,);
        } finally {
            setLoadingMore(false,);
        }
    };

    const onLoggedIn = () => {
        void refetchConfig();
        void refetchItems();
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
                                    title={cfg().reason === 'signin' ? 'Members only' : 'Subscriber gallery'}
                                    message={cfg().reason === 'signin'
                                        ? 'Log in or create an account to view the gallery.'
                                        : cfg().requiredTier
                                        ? <>The gallery is for <strong>{cfg().requiredTier!.name}</strong> subscribers.</>
                                        : 'The gallery requires a subscription.'}
                                    onLoggedIn={onLoggedIn}
                                />
                            }
                        >
                            <Show when={firstPage() !== undefined} fallback={<p class="gallery-page__loading">Loading…</p>}>
                                <GalleryView
                                    items={items()}
                                    settings={appearanceToView(cfg().appearance,)}
                                    thumbSize={cfg().appearance.thumbSize}
                                    hoverZoom={cfg().appearance.hoverZoom}
                                    videoBadge={cfg().appearance.videoBadge}
                                    empty="Nothing here yet."
                                />
                                <Show when={items().length < total()}>
                                    <div class="gallery-page__more">
                                        <button type="button" class="btn" disabled={loadingMore()} onClick={() => void loadMore()}>
                                            {loadingMore() ? 'Loading…' : 'Load more'}
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
