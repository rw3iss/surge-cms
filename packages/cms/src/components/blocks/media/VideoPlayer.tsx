/**
 * Plyr-based video player.
 *
 * Plays a plain file (MP4/WebM/MOV/OGV — MIME derived from the extension when
 * `type` is not given) or an HLS stream. HLS uses hls.js, LAZY-loaded (its own
 * chunk) only when an HLS source is about to play; Safari/iOS play HLS natively
 * and get no quality menu. With hls.js, Plyr is created AFTER the manifest is
 * parsed so its quality menu can list the stream's levels.
 *
 * Encrypted (private) streams fetch their AES key from the same-origin API with
 * the session cookie. A viewer without permission gets 401/403 on the key —
 * reported through `onLocked`.
 */
import type HlsType from 'hls.js';
import Plyr from 'plyr';
import { Component, createEffect, on, onCleanup, onMount, } from 'solid-js';
import 'plyr/dist/plyr.css';
import { HLS_MIME, isHlsUrl, videoMimeFromUrl, } from '../../../utils/resolveVideoSource';

type HlsCtor = typeof HlsType;

interface VideoPlayerProps {
    /** Plain file URL (or an `.m3u8`, which is treated as HLS). */
    src?: string;
    /** HLS master playlist. Wins over `src`. */
    hlsSrc?: string;
    /** MIME of `src`; derived from the extension when absent. */
    type?: string;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
    poster?: string;
    /** WebVTT sprite map for scrub-bar previews. */
    thumbnailsVtt?: string;
    /** HLS start quality: `auto`, `highest`, or a height (e.g. 720). */
    startLevel?: 'auto' | 'highest' | number;
    /** Show the HLS quality menu (default true). */
    qualityMenu?: boolean;
    preload?: 'none' | 'metadata' | 'auto';
    class?: string;
    style?: Record<string, string>;
    onReady?: (player: Plyr,) => void;
    /** The stream's key was refused (401/403) — the viewer may not watch it. */
    onLocked?: () => void;
    onEnded?: () => void;
    /** No Plyr chrome: a bare <video> (background slides). hls.js still
     *  attaches; autoplay/muted/loop go straight onto the element. */
    bare?: boolean;
    /** The underlying <video> element. */
    ref?: (el: HTMLVideoElement,) => void;
}

let hlsModule: Promise<HlsCtor> | null = null;
/** hls.js light build (no EME/subtitles/alt-audio; AES-128 included), own chunk. */
function loadHls(): Promise<HlsCtor> {
    hlsModule ??= import('hls.js/light').then((m,) => m.default);
    // A failed chunk load must not stick: the next attempt retries.
    hlsModule.catch(() => { hlsModule = null; },);
    return hlsModule;
}

const BASE_CONTROLS = ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume',];

const VideoPlayer: Component<VideoPlayerProps> = (props,) => {
    let videoRef: HTMLVideoElement | undefined;
    let player: Plyr | undefined;
    let hls: HlsType | undefined;
    /** Bumped per source change so a late async setup can tell it is stale. */
    let generation = 0;

    const teardown = () => {
        hls?.destroy();
        hls = undefined;
        player?.destroy();
        player = undefined;
        if (videoRef) {
            videoRef.removeAttribute('src',);
            videoRef.replaceChildren();
        }
    };

    const createPlyr = (quality?: Plyr.Options['quality'],) => {
        if (!videoRef || props.bare) return;
        const controls = props.controls !== false
            ? [...BASE_CONTROLS, ...(quality ? ['settings',] : []), 'fullscreen',]
            : [];
        player = new Plyr(videoRef, {
            controls,
            settings: quality ? ['quality',] : [],
            quality,
            i18n: quality ? { qualityLabel: { 0: 'Auto', }, } : undefined,
            autoplay: props.autoplay || false,
            muted: props.muted || false,
            loop: { active: props.loop || false, },
            clickToPlay: true,
            hideControls: true,
            resetOnEnd: false,
            keyboard: { focused: true, global: false, },
            previewThumbnails: props.thumbnailsVtt
                ? { enabled: true, src: props.thumbnailsVtt, }
                : { enabled: false, },
        },);
        const p = player;
        if (props.onReady) p.on('ready', () => props.onReady?.(p,),);
        p.on('ended', () => props.onEnded?.(),);
    };

    const setupFile = (src: string, type: string,) => {
        const video = videoRef;
        if (!video) return;
        // A <source type> (not the src attribute) so the browser knows the MIME
        // up front instead of sniffing — and skips a type it cannot play.
        video.removeAttribute('src',);
        video.replaceChildren();
        const source = document.createElement('source',);
        source.src = src;
        source.type = type;
        video.appendChild(source,);
        video.load();
        createPlyr();
    };

    const setupHls = async (src: string, gen: number,) => {
        const video = videoRef;
        if (!video) return;
        const Hls = await loadHls().catch(() => null);
        if (gen !== generation) return;

        if (!Hls || !Hls.isSupported()) {
            // Safari / iOS: native HLS, no quality menu.
            if (video.canPlayType(HLS_MIME,)) {
                video.src = src;
                createPlyr();
            }
            return;
        }

        const lazyLoad = props.preload === 'none' && !props.autoplay;
        const instance = new Hls({
            enableWorker: true,
            capLevelToPlayerSize: true,
            autoStartLoad: !lazyLoad,
            // Same-origin key requests carry the session cookie already; this
            // also covers a key host on a sibling origin.
            xhrSetup: (xhr, url,) => {
                if (url.includes('/hls-key/',)) xhr.withCredentials = true;
            },
        },);
        hls = instance;

        instance.on(Hls.Events.MANIFEST_PARSED, () => {
            if (gen !== generation) return;
            const heights = [...new Set(instance.levels.map((l,) => l.height).filter((h,) => h > 0),),]
                .toSorted((a, b,) => b - a);

            // Start level.
            let fixedHeight = 0;
            const start = props.startLevel ?? 'auto';
            if (start === 'highest' && heights.length) fixedHeight = heights[0];
            else if (typeof start === 'number' && heights.length) {
                fixedHeight = heights.find((h,) => h <= start) ?? heights[heights.length - 1];
            }
            if (fixedHeight) {
                const idx = instance.levels.findIndex((l,) => l.height === fixedHeight);
                if (idx >= 0) instance.startLevel = idx;
            }

            const showQuality = props.qualityMenu !== false && heights.length > 1;
            createPlyr(showQuality
                ? {
                    default: fixedHeight,
                    options: [0, ...heights,],
                    forced: true,
                    onChange: (q: number,) => {
                        if (!hls) return;
                        if (q === 0) {
                            hls.currentLevel = -1;
                            return;
                        }
                        const idx = hls.levels.findIndex((l,) => l.height === q);
                        if (idx >= 0) hls.currentLevel = idx;
                    },
                }
                : undefined,);
        },);

        instance.on(Hls.Events.ERROR, (_evt, data,) => {
            const code = (data.response as { code?: number; } | undefined)?.code;
            const denied = code === 401 || code === 403;
            if (data.details === Hls.ErrorDetails.KEY_LOAD_ERROR && (data.fatal || denied)) {
                props.onLocked?.();
                instance.stopLoad();
                return;
            }
            if (!data.fatal) return;
            if (denied) {
                props.onLocked?.();
                instance.stopLoad();
            } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                instance.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                instance.recoverMediaError();
            } else {
                instance.destroy();
                if (hls === instance) hls = undefined;
            }
        },);

        if (lazyLoad) {
            video.addEventListener('play', () => instance.startLoad(), { once: true, },);
        }
        instance.loadSource(src,);
        instance.attachMedia(video,);
    };

    const sourceKey = () => {
        const hlsSrc = props.hlsSrc || (isHlsUrl(props.src,) || props.type === HLS_MIME ? props.src : undefined);
        if (hlsSrc) return { hls: true, src: hlsSrc, type: HLS_MIME, };
        const src = props.src || '';
        return { hls: false, src, type: props.type || videoMimeFromUrl(src,), };
    };

    onMount(() => {
        createEffect(on(
            () => {
                const k = sourceKey();
                return `${k.hls ? 'hls' : 'file'}|${k.src}|${k.type}|${props.thumbnailsVtt ?? ''}`;
            },
            () => {
                const gen = ++generation;
                teardown();
                const k = sourceKey();
                if (!k.src) return;
                if (k.hls) void setupHls(k.src, gen,);
                else setupFile(k.src, k.type,);
            },
        ),);
    },);

    onCleanup(() => {
        generation++;
        teardown();
    },);

    return (
        <video
            ref={(el,) => {
                videoRef = el;
                props.ref?.(el,);
            }}
            poster={props.poster}
            autoplay={props.bare ? props.autoplay : undefined}
            muted={props.bare ? props.muted : undefined}
            loop={props.bare ? props.loop : undefined}
            onEnded={() => {
                if (props.bare) props.onEnded?.();
            }}
            playsinline
            preload={props.preload ?? 'metadata'}
            class={props.class}
            style={props.style}
        />
    );
};

export default VideoPlayer;
