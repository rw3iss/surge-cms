/**
 * A library video, played by media id.
 *
 * Reads `cms.media.playback(id)` (or takes `playback` from the caller) and
 * picks what to play: the FULL stream (HLS, only present when the viewer may
 * watch it), the TEASER (public first-N-seconds clip), or a plain uploaded file.
 * A viewer without full access sees the teaser with a "Preview" badge and a
 * subscribe prompt at the end; with no teaser, a locked poster.
 *
 * When playback cannot be read (the `video` feature is off, an old media row),
 * `fallbackSrc` plays as a plain file instead.
 */
import { A, } from '@solidjs/router';
import type { MediaPlayback, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import VideoPlayer from './VideoPlayer';
import './MediaVideo.scss';

export const MEMBERSHIP_URL = '/profile?tab=membership';

/** Re-read playback this often while a video is still processing. */
const PROCESSING_POLL_MS = 15_000;

export interface MediaVideoProps {
    mediaId: string;
    playback?: MediaPlayback;
    variant?: 'auto' | 'full' | 'teaser';
    showVariantSwitch?: boolean;
    showQualityMenu?: boolean;
    autoplay?: boolean;
    class?: string;
    lockedCta?: JSX.Element;
    /** Played as a plain file when playback cannot be read. */
    fallbackSrc?: string;
    fallbackType?: string;
}

type Chosen = 'full' | 'teaser' | 'file' | null;

function formatBytes(n: number | null,): string {
    if (!n) return '';
    const mb = n / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(1,)} GB` : `${Math.max(1, Math.round(mb,),)} MB`;
}

const MediaVideo: Component<MediaVideoProps> = (props,) => {
    const [fetched, setFetched,] = createSignal<MediaPlayback | null>(null,);
    const [failed, setFailed,] = createSignal(false,);
    const [locked, setLocked,] = createSignal(false,);
    const [userVariant, setUserVariant,] = createSignal<'full' | 'teaser' | null>(null,);
    const [ended, setEnded,] = createSignal(false,);

    const pb = () => props.playback ?? fetched();

    /**
     * The video's display shape (width ÷ height): from the playback info, then
     * from the loaded file (exact, rotation applied). Published as `--vp-ar` so
     * a container can size the player to the FITTED video — see
     * `.block--video` in BlockRenderer.scss.
     */
    const [loadedRatio, setLoadedRatio,] = createSignal<number | null>(null,);
    const ratio = (): number | null => {
        if (loadedRatio()) return loadedRatio();
        const p = pb();
        return p?.width && p?.height ? p.width / p.height : null;
    };
    const onPlayerReady = (v: HTMLVideoElement,) => {
        if (v.videoWidth && v.videoHeight) setLoadedRatio(v.videoWidth / v.videoHeight,);
    };

    // Fetch (and poll while processing) when the caller did not supply playback.
    createEffect(on(
        () => [props.mediaId, props.playback,] as const,
        ([id, given,],) => {
            setLocked(false,);
            setEnded(false,);
            setUserVariant(null,);
            if (given || !id) return;
            let alive = true;
            let timer: ReturnType<typeof setTimeout> | undefined;
            setFetched(null,);
            setFailed(false,);
            const load = async () => {
                try {
                    const p = await cms.media.playback(id,);
                    if (!alive) return;
                    setFetched(p,);
                    const playable = p.src || p.teaserSrc || p.fileSrc;
                    if (!playable && (p.status === 'processing' || p.status === 'uploading')) {
                        timer = setTimeout(load, PROCESSING_POLL_MS,);
                    }
                } catch {
                    if (alive) setFailed(true,);
                }
            };
            void load();
            onCleanup(() => {
                alive = false;
                if (timer) clearTimeout(timer,);
            },);
        },
    ),);

    const chosen = createMemo<Chosen>(() => {
        const p = pb();
        if (!p) return null;
        const full = Boolean(p.src,) && !locked();
        const teaser = Boolean(p.teaserSrc,);
        const want = userVariant() ?? props.variant ?? 'auto';
        if (want === 'teaser' && teaser) return 'teaser';
        if (want === 'full' && full) return 'full';
        if (full) return 'full';
        if (teaser) return 'teaser';
        if (p.fileSrc && !locked()) return 'file';
        return null;
    },);

    /** The viewer is not watching the full video because they may not. */
    const noFullAccess = () => {
        const p = pb();
        return Boolean(p,) && (locked() || (!p!.access.full && p!.access.reason === 'private'));
    };

    const isProcessing = () => {
        const p = pb();
        return Boolean(p,) && !chosen() && (p!.status === 'processing' || p!.status === 'uploading');
    };

    const isLocked = () => !chosen() && noFullAccess();

    const showPreviewBadge = () => chosen() === 'teaser' && noFullAccess();
    const canSwitch = () => {
        const p = pb();
        return Boolean(props.showVariantSwitch && p?.src && p.teaserSrc && !locked(),);
    };

    const cta = () => props.lockedCta ?? (
        <A href={MEMBERSHIP_URL} class="media-video__cta-link">Subscribe to watch the full video</A>
    );

    const hasToolbar = () => canSwitch() || (pb()?.downloads.length ?? 0) > 0;

    const onDownload = (e: Event & { currentTarget: HTMLSelectElement; },) => {
        const url = e.currentTarget.value;
        e.currentTarget.value = '';
        if (url) window.location.assign(url,);
    };

    return (
        <div
            class={`media-video${hasToolbar() ? ' media-video--has-toolbar' : ''}${props.class ? ` ${props.class}` : ''}`}
            style={ratio() ? { '--vp-ar': String(ratio(),), } : undefined}
        >
            <Show
                when={!failed()}
                fallback={
                    <Show
                        when={props.fallbackSrc}
                        fallback={<div class="media-video__stage media-video__stage--empty">Video unavailable</div>}
                    >
                        <VideoPlayer src={props.fallbackSrc} type={props.fallbackType} autoplay={props.autoplay} muted={props.autoplay} />
                    </Show>
                }
            >
                <div class="media-video__stage">
                    <Show
                        when={chosen()}
                        keyed
                        fallback={
                            <div class="media-video__placeholder">
                                <Show when={pb()?.posterUrl}>
                                    <img src={pb()!.posterUrl!} alt="" class="media-video__poster" />
                                </Show>
                                <Show when={pb()}>
                                    <div class="media-video__overlay">
                                        <Show when={isProcessing()}>
                                            <p class="media-video__overlay-text">Processing…</p>
                                        </Show>
                                        <Show when={isLocked()}>
                                            <p class="media-video__overlay-title">For subscribers</p>
                                            {cta()}
                                        </Show>
                                        <Show when={!isProcessing() && !isLocked()}>
                                            <p class="media-video__overlay-text">Video unavailable</p>
                                        </Show>
                                    </div>
                                </Show>
                            </div>
                        }
                    >
                        {/* keyed: switching Full ↔ Teaser mounts a fresh player
                            (new Plyr + hls.js) instead of re-sourcing a live one. */}
                        {(c,) => (
                            <>
                                <VideoPlayer
                                    hlsSrc={c === 'full' ? pb()!.src! : c === 'teaser' ? pb()!.teaserSrc! : undefined}
                                    src={c === 'file' ? pb()!.fileSrc! : undefined}
                                    type={c === 'file' ? pb()!.fileType ?? undefined : undefined}
                                    poster={pb()!.posterUrl ?? undefined}
                                    thumbnailsVtt={c === 'full' ? pb()!.thumbnailsVtt ?? undefined : undefined}
                                    autoplay={props.autoplay || userVariant() !== null}
                                    qualityMenu={props.showQualityMenu !== false}
                                    muted={props.autoplay}
                                    onLocked={() => setLocked(true,)}
                                    onEnded={() => setEnded(true,)}
                                    onReady={onPlayerReady}
                                />
                                <Show when={showPreviewBadge()}>
                                    <span class="media-video__badge">Preview</span>
                                </Show>
                                <Show when={showPreviewBadge() && ended()}>
                                    <div class="media-video__overlay media-video__overlay--end">
                                        <p class="media-video__overlay-title">That was a preview</p>
                                        {cta()}
                                    </div>
                                </Show>
                            </>
                        )}
                    </Show>
                </div>

                <Show when={canSwitch() || (pb()?.downloads.length ?? 0) > 0}>
                    <div class="media-video__toolbar">
                        <Show when={canSwitch()}>
                            <select
                                class="media-video__select"
                                aria-label="Video version"
                                value={chosen() === 'teaser' ? 'teaser' : 'full'}
                                onChange={(e,) => {
                                    setEnded(false,);
                                    setUserVariant(e.currentTarget.value as 'full' | 'teaser',);
                                }}
                            >
                                <option value="full">Full video</option>
                                <option value="teaser">Teaser</option>
                            </select>
                        </Show>
                        <Show when={(pb()?.downloads.length ?? 0) > 0}>
                            <select class="media-video__select" aria-label="Download" value="" onChange={onDownload}>
                                <option value="">Download…</option>
                                <For each={pb()!.downloads}>
                                    {(d,) => (
                                        <option value={d.url}>
                                            {d.quality}{d.bytes ? ` (${formatBytes(d.bytes,)})` : ''}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </Show>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default MediaVideo;
