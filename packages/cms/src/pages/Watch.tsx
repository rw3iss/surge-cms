/**
 * Public player page — /watch/:id.
 *
 * Where a video's direct link (`/api/v1/video/:id/file`) sends a viewer who
 * may not get the plain file: a signed-out visitor, a member without
 * `media.private:view`, or a subscriber whose short-lived session cookie had
 * lapsed (this page runs in the SPA, which refreshes the session — so they
 * then get the full video here). Everyone else sees the teaser and the
 * subscribe prompt; a video still encoding shows "Processing…".
 */
import NotFoundPage from './NotFound';
import type { MediaPlayback, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createEffect, createSignal, on, onCleanup, Show, } from 'solid-js';
import MediaVideo from '../components/blocks/media/MediaVideo';
import { cms, } from '../services/cmsClient';
import './Watch.scss';

const POLL_MS = 15_000;

const WatchPage: Component = () => {
    const params = useParams<{ id: string; }>();
    const [pb, setPb,] = createSignal<MediaPlayback | null>(null,);
    const [missing, setMissing,] = createSignal(false,);

    createEffect(on(() => params.id, (id,) => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setPb(null,);
        setMissing(false,);
        const load = async () => {
            try {
                const p = await cms.media.playback(id,);
                if (!alive) return;
                setPb(p,);
                if (!p.src && !p.teaserSrc && !p.fileSrc && p.status === 'processing') timer = setTimeout(load, POLL_MS,);
            } catch {
                if (alive) setMissing(true,);
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
            <Show
                when={!missing()}
                fallback={
                    <NotFoundPage title="Video not found" message="This video doesn't exist, or it has been removed." link={{ href: "/posts", label: "Browse posts", }} />
                }
            >
                <Show when={pb()} fallback={<div class="watch-page__loading" />}>
                    <h1 class="watch-page__title">{pb()!.title}</h1>
                    <MediaVideo mediaId={params.id} playback={pb()!} showQualityMenu />
                </Show>
            </Show>
        </div>
    );
};

export default WatchPage;
