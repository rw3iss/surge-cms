/**
 * Public player page — /watch/:id.
 *
 * Where a video's direct link (`/api/v1/video/:id/file`) sends a viewer who
 * may not get the plain file: a signed-out visitor, a member without
 * `media.private:view`, or a subscriber whose short-lived session cookie had
 * lapsed (this page runs in the SPA, which refreshes the session — so they
 * then get the full video here). A PRIVATE video this viewer may not watch
 * goes to the access-denied fallback (`utils/accessDenied` — the login page
 * with `reason=signin|forbidden`), except a share link (`?t=`), which keeps
 * the teaser + subscribe prompt. A video still encoding shows "Processing…".
 */
import NotFoundPage from './NotFound';
import type { MediaPlayback, } from '@sitesurge/types';
import { NotFoundError, } from '@sitesurge/client';
import { Meta, Title, } from '@solidjs/meta';
import { useNavigate, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createSignal, on, onCleanup, Show, } from 'solid-js';
import MediaVideo from '../components/blocks/media/MediaVideo';
import { Spinner, } from '../components/ui/Spinner';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import { handleAccessDenied, } from '../utils/accessDenied';
import './Watch.scss';

const POLL_MS = 15_000;

const WatchPage: Component = () => {
    const params = useParams<{ id: string; }>();
    const [search,] = useSearchParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const [pb, setPb,] = createSignal<MediaPlayback | null>(null,);
    const [missing, setMissing,] = createSignal(false,);
    /** Any failure other than "no such video" (network, 500): an error + Retry, not the 404 page. */
    const [failed, setFailed,] = createSignal<string | null>(null,);
    const [attempt, setAttempt,] = createSignal(0,);

    // Re-read when the viewer changes (playback is role-shaped); wait for the session check first.
    createEffect(on(() => [params.id, auth.isLoading, auth.user?.id ?? null, attempt(),] as const, ([id, loading,],) => {
        if (loading) return;
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setPb(null,);
        setMissing(false,);
        setFailed(null,);
        const load = async () => {
            try {
                const p = await cms.media.playback(id,);
                if (!alive) return;
                // Not this viewer's to watch: the access-denied fallback. A share link keeps the teaser.
                if (!p.access.full && p.access.reason === 'private' && !search.t) {
                    handleAccessDenied(navigate, auth.user ? 'forbidden' : 'signin',);
                    return;
                }
                setPb(p,);
                if (!p.src && !p.teaserSrc && !p.fileSrc && p.status === 'processing') timer = setTimeout(load, POLL_MS,);
            } catch (e) {
                if (!alive) return;
                if (e instanceof NotFoundError) setMissing(true,);
                else setFailed((e as Error)?.message || 'The video could not be loaded.',);
            }
        };
        void load();
        onCleanup(() => {
            alive = false;
            if (timer) clearTimeout(timer,);
        },);
    },),);

    return (
        <div class="watch-page page-wrapper">
            <Title>{pb()?.title || 'Video'}</Title>
            {/* A private video's watch page is not a useful search result. */}
            <Show when={pb()?.accessLevel === 'private'}>
                <Meta name="robots" content="noindex" />
            </Show>
            <Show
                when={!missing()}
                fallback={
                    <NotFoundPage title="Video not found" message="This video doesn't exist, or it has been removed." link={{ href: "/posts", label: "Browse posts", }} />
                }
            >
                <Show
                    when={!failed()}
                    fallback={
                        <div class="watch-page__error" role="alert">
                            <p>Couldn't load this video. {failed()}</p>
                            <button type="button" class="btn" onClick={() => setAttempt((n,) => n + 1,)}>Retry</button>
                        </div>
                    }
                >
                    <Show
                        when={pb()}
                        fallback={
                            <div class="watch-page__loading" aria-busy="true" aria-label="Loading video">
                                <Spinner />
                            </div>
                        }
                    >
                        <h1 class="watch-page__title">{pb()!.title}</h1>
                        <MediaVideo mediaId={params.id} playback={pb()!} showQualityMenu />
                    </Show>
                </Show>
            </Show>
        </div>
    );
};

export default WatchPage;
