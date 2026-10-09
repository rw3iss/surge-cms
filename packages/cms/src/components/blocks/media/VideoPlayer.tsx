/**
 * Video player with our own control layer.
 *
 * Plays a plain file (MP4/WebM/MOV/OGV — MIME derived from the extension when
 * `type` is not given) or an HLS stream. HLS uses hls.js, LAZY-loaded (its own
 * chunk) only when an HLS source is about to play; Safari/iOS play HLS natively
 * and get no quality menu.
 *
 * Encrypted (private) streams fetch their AES key from the same-origin API with
 * the session cookie. A viewer without permission gets 401/403 on the key —
 * reported through `onLocked`.
 *
 * The UI is composed from `./player/*`: media state (useVideoState), SeekBar,
 * VolumeControl, SettingsMenu, fullscreen helpers and icons. `bare` renders
 * only the <video> (background slides).
 *
 * LIVE mode (`live`): a real-time stream — no seek bar, duration, seeking or
 * speed menu; a red LIVE pill instead of the time; starts muted (autoplay
 * rules) with a large "Tap to unmute". The picture comes from `srcObject`
 * (a WebRTC MediaStream), from a caller that sets `srcObject` on the element
 * itself (via `ref`), or from `hlsSrc`.
 */
import type HlsType from 'hls.js';
import { Component, createEffect, createSignal, on, onCleanup, onMount, Show, } from 'solid-js';
import { HLS_MIME, isHlsUrl, videoMimeFromUrl, } from '../../../utils/resolveVideoSource';
import { canFullscreen, onFullscreenChange, toggleFullscreen, } from './player/fullscreen';
import {
    IconAlert,
    IconForward,
    IconFullscreen,
    IconFullscreenExit,
    IconPause,
    IconPip,
    IconPlay,
    IconRewind,
    IconVolumeMuted,
} from './player/icons';
import SeekBar from './player/SeekBar';
import SettingsMenu from './player/SettingsMenu';
import { formatTime, useVideoState, } from './player/useVideoState';
import VolumeControl from './player/VolumeControl';
import './VideoPlayer.scss';

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
    /** `false` → no control bar (click still plays/pauses). */
    controls?: boolean;
    poster?: string;
    /** Accessible name of the player region. */
    title?: string;
    /** WebVTT sprite map for seek-bar previews. */
    thumbnailsVtt?: string;
    /** HLS start quality: `auto`, `highest`, or a height (e.g. 720). */
    startLevel?: 'auto' | 'highest' | number;
    /** Show the HLS quality menu (default true). */
    qualityMenu?: boolean;
    preload?: 'none' | 'metadata' | 'auto';
    class?: string;
    style?: Record<string, string>;
    /** Metadata loaded for the current source. */
    onReady?: (video: HTMLVideoElement,) => void;
    /** The stream's key was refused (401/403) — the viewer may not watch it. */
    onLocked?: () => void;
    onEnded?: () => void;
    /** No chrome: a bare <video> (background slides). hls.js still attaches;
     *  autoplay/muted/loop go straight onto the element. */
    bare?: boolean;
    /** The underlying <video> element. */
    ref?: (el: HTMLVideoElement,) => void;
    /** A MediaStream to play (WebRTC). Wins over `src`/`hlsSrc` while set. */
    srcObject?: MediaStream | null;
    /** Real-time stream: no seeking / duration; LIVE pill; starts muted. */
    live?: boolean;
}

let hlsModule: Promise<HlsCtor> | null = null;
/** hls.js light build (no EME/subtitles/alt-audio; AES-128 included), own chunk. */
function loadHls(): Promise<HlsCtor> {
    hlsModule ??= import('hls.js/light').then((m,) => m.default);
    // A failed chunk load must not stick: the next attempt retries.
    hlsModule.catch(() => { hlsModule = null; },);
    return hlsModule;
}

const PREFS_KEY = 'surge.player.volume';
const HIDE_MS = 2500;
const DOUBLE_TAP_MS = 300;

interface VolumePrefs { volume: number; muted: boolean; }

function readPrefs(): VolumePrefs | null {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY,) ?? 'null',) as Partial<VolumePrefs> | null;
        if (!p || typeof p.volume !== 'number') return null;
        return { volume: Math.min(1, Math.max(0, p.volume,),), muted: Boolean(p.muted,), };
    } catch {
        return null;
    }
}

function writePrefs(p: VolumePrefs,): void {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(p,),);
    } catch {
        // Private mode / quota — not worth surfacing.
    }
}

const VideoPlayer: Component<VideoPlayerProps> = (props,) => {
    let video: HTMLVideoElement | undefined;
    let root: HTMLDivElement | undefined;
    let hls: HlsType | undefined;
    /** Bumped per source change so a late async setup can tell it is stale. */
    let generation = 0;

    const st = useVideoState();
    const [heights, setHeights,] = createSignal<number[]>([],);
    const [quality, setQuality,] = createSignal(0,);
    const [autoHeight, setAutoHeight,] = createSignal<number | null>(null,);
    const [fs, setFs,] = createSignal(false,);
    const [fsOk, setFsOk,] = createSignal(false,);
    const [pipOk, setPipOk,] = createSignal(false,);
    const [pip, setPip,] = createSignal(false,);
    const [active, setActive,] = createSignal(false,);
    const [seekActive, setSeekActive,] = createSignal(false,);
    const [volOpen, setVolOpen,] = createSignal(false,);
    const [menuOpen, setMenuOpen,] = createSignal(false,);
    const [kbdFocus, setKbdFocus,] = createSignal(false,);
    const [remaining, setRemaining,] = createSignal(false,);
    const [ripple, setRipple,] = createSignal<{ side: 'left' | 'right'; seconds: number; } | null>(null,);

    const showBar = () => props.controls !== false;
    const controlsVisible = () =>
        !st.started() || st.paused() || active() || seekActive() || volOpen() || menuOpen() || kbdFocus()
        || Boolean(st.error(),);

    // ── Auto-hide ────────────────────────────────────────────────────────
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const poke = () => {
        setActive(true,);
        clearTimeout(idleTimer,);
        idleTimer = setTimeout(() => setActive(false,), HIDE_MS,);
    };
    const hideNow = () => {
        clearTimeout(idleTimer,);
        setActive(false,);
    };

    // ── Playback actions ─────────────────────────────────────────────────
    const play = () => void video?.play().catch(() => {},);
    const togglePlay = () => {
        if (!video) return;
        if (video.paused || video.ended) play();
        else video.pause();
    };
    const seekBy = (d: number,) => {
        if (!video || props.live) return;
        const end = st.duration() || Number.POSITIVE_INFINITY;
        video.currentTime = Math.min(end, Math.max(0, video.currentTime + d,),);
    };
    const setVolume = (v: number,) => {
        if (!video) return;
        video.volume = v;
        video.muted = v === 0;
        writePrefs({ volume: v, muted: video.muted, },);
    };
    const toggleMute = () => {
        if (!video) return;
        if (video.muted && video.volume === 0) video.volume = 0.5;
        video.muted = !video.muted;
        writePrefs({ volume: video.volume, muted: video.muted, },);
    };
    const toggleFs = () => {
        if (root && video) void toggleFullscreen(root, video,);
    };
    const togglePip = async () => {
        if (!video) return;
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await video.requestPictureInPicture();
        } catch {
            // Refused (no metadata yet / disabled) — leave as is.
        }
    };
    const chooseQuality = (h: number,) => {
        setQuality(h,);
        if (!hls) return;
        if (h === 0) {
            hls.currentLevel = -1;
            return;
        }
        const idx = hls.levels.findIndex((l,) => l.height === h);
        if (idx >= 0) hls.currentLevel = idx;
    };

    // ── Source setup ─────────────────────────────────────────────────────
    const teardown = () => {
        hls?.destroy();
        hls = undefined;
        setHeights([],);
        setQuality(0,);
        setAutoHeight(null,);
        if (video) {
            video.removeAttribute('src',);
            video.replaceChildren();
        }
    };

    const setupFile = (src: string, type: string,) => {
        if (!video) return;
        // A <source type> (not the src attribute) so the browser knows the MIME
        // up front instead of sniffing — and skips a type it cannot play.
        const source = document.createElement('source',);
        source.src = src;
        source.type = type;
        // A failed <source> fires `error` on itself, not on the <video>.
        source.addEventListener('error', () => st.setError('This video could not be loaded.',),);
        video.appendChild(source,);
        video.load();
    };

    const setupHls = async (src: string, gen: number,) => {
        const v = video;
        if (!v) return;
        const Hls = await loadHls().catch(() => null);
        if (gen !== generation) return;

        if (!Hls || !Hls.isSupported()) {
            // Safari / iOS: native HLS, no quality menu.
            if (v.canPlayType(HLS_MIME,)) v.src = src;
            else st.setError('This video cannot be played in this browser.',);
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
            const hs = [...new Set(instance.levels.map((l,) => l.height).filter((h,) => h > 0),),]
                .toSorted((a, b,) => b - a);

            // Start level: a fixed start locks that level (Auto stays one click away).
            let fixedHeight = 0;
            const start = props.startLevel ?? 'auto';
            if (start === 'highest' && hs.length) fixedHeight = hs[0];
            else if (typeof start === 'number' && hs.length) {
                fixedHeight = hs.find((h,) => h <= start) ?? hs[hs.length - 1];
            }
            if (fixedHeight) {
                const idx = instance.levels.findIndex((l,) => l.height === fixedHeight);
                if (idx >= 0) {
                    instance.startLevel = idx;
                    instance.loadLevel = idx;
                }
            }
            setQuality(fixedHeight,);
            setHeights(props.qualityMenu !== false && hs.length > 1 ? hs : [],);
        },);

        instance.on(Hls.Events.LEVEL_SWITCHED, (_evt, data,) => {
            const h = instance.levels[data.level]?.height;
            setAutoHeight(h || null,);
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
                st.setError('This video could not be played.',);
            }
        },);

        if (lazyLoad) {
            v.addEventListener('play', () => instance.startLoad(), { once: true, },);
        }
        instance.loadSource(src,);
        instance.attachMedia(v,);
    };

    const sourceKey = () => {
        const hlsSrc = props.hlsSrc || (isHlsUrl(props.src,) || props.type === HLS_MIME ? props.src : undefined);
        if (hlsSrc) return { hls: true, src: hlsSrc, type: HLS_MIME, };
        const src = props.src || '';
        return { hls: false, src, type: props.type || videoMimeFromUrl(src,), };
    };

    onMount(() => {
        const v = video!;
        if (!props.bare) {
            onCleanup(st.bind(v,),);
            const prefs = readPrefs();
            if (prefs) v.volume = prefs.volume;
            // Autoplay needs muted; otherwise honour the viewer's last choice.
            // Live always starts muted — it autoplays, and "Tap to unmute" is offered.
            v.muted = Boolean(props.muted,) || Boolean(props.live,) || Boolean(prefs?.muted,);

            setFsOk(Boolean(root,) && canFullscreen(v,),);
            if (root) onCleanup(onFullscreenChange(root, v, setFs,),);

            setPipOk(Boolean(document.pictureInPictureEnabled,) && !v.disablePictureInPicture,);
            const onPip = () => setPip(document.pictureInPictureElement === v,);
            v.addEventListener('enterpictureinpicture', onPip,);
            v.addEventListener('leavepictureinpicture', onPip,);
            onCleanup(() => {
                v.removeEventListener('enterpictureinpicture', onPip,);
                v.removeEventListener('leavepictureinpicture', onPip,);
            },);
        }

        createEffect(on(
            () => {
                const k = sourceKey();
                return `${k.hls ? 'hls' : 'file'}|${k.src}|${k.type}`;
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

        // A MediaStream source (WebRTC). Only touched when the prop is used,
        // so a caller driving `srcObject` itself (through `ref`) is left alone.
        createEffect(on(() => props.srcObject, (stream, prev,) => {
            if (stream === undefined && prev === undefined) return;
            v.srcObject = stream ?? null;
            if (stream && (props.autoplay || props.live)) play();
        },),);
    },);

    onCleanup(() => {
        generation++;
        clearTimeout(idleTimer,);
        clearTimeout(tapTimer,);
        clearTimeout(rippleTimer,);
        teardown();
    },);

    // ── Surface gestures ─────────────────────────────────────────────────
    let lastPointer = 'mouse';
    let lastTap: { t: number; zone: 'left' | 'center' | 'right'; } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    let rippleTimer: ReturnType<typeof setTimeout> | undefined;

    const showRipple = (side: 'left' | 'right',) => {
        const prev = ripple();
        setRipple({ side, seconds: prev && prev.side === side ? prev.seconds + 10 : 10, },);
        clearTimeout(rippleTimer,);
        rippleTimer = setTimeout(() => setRipple(null,), 650,);
    };

    const singleTap = () => {
        if (!st.started()) play();
        else if (controlsVisible() && !st.paused()) hideNow();
        else poke();
    };

    const onSurfacePointerUp = (e: PointerEvent,) => {
        if (e.pointerType === 'mouse') return;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const zone = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'center';
        const now = performance.now();
        const isDouble = lastTap && now - lastTap.t < DOUBLE_TAP_MS && lastTap.zone === zone;
        lastTap = { t: now, zone, };
        clearTimeout(tapTimer,);
        if (isDouble && zone !== 'center' && st.started() && !props.live) {
            seekBy(zone === 'left' ? -10 : 10,);
            showRipple(zone,);
            return;
        }
        // Side zones wait to see whether a second tap follows.
        if (zone === 'center' || !st.started() || props.live) singleTap();
        else tapTimer = setTimeout(singleTap, DOUBLE_TAP_MS,);
    };

    // ── Keyboard ─────────────────────────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !video) return;
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select, [role="menu"]',)) return;
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (t !== root && t.closest('button',) && (key === ' ' || key === 'Enter')) return;
        switch (key) {
            case ' ':
            case 'k':
                togglePlay();
                break;
            case 'j':
                if (props.live) return;
                seekBy(-10,);
                break;
            case 'l':
                if (props.live) return;
                seekBy(10,);
                break;
            case 'ArrowLeft':
                if (props.live) return;
                seekBy(-5,);
                break;
            case 'ArrowRight':
                if (props.live) return;
                seekBy(5,);
                break;
            case 'ArrowUp':
                setVolume(Math.min(1, (video.muted ? 0 : video.volume) + 0.05,),);
                break;
            case 'ArrowDown':
                setVolume(Math.max(0, (video.muted ? 0 : video.volume) - 0.05,),);
                break;
            case 'm':
                toggleMute();
                break;
            case 'f':
                toggleFs();
                break;
            default:
                if (/^[0-9]$/.test(key,) && st.duration() && !props.live) {
                    video.currentTime = (st.duration() * Number(key,)) / 10;
                    break;
                }
                return;
        }
        e.preventDefault();
        poke();
    };

    const videoEl = (
        <video
            ref={(el,) => {
                video = el;
                props.ref?.(el,);
            }}
            poster={props.poster}
            autoplay={props.autoplay}
            muted={props.muted}
            loop={props.loop}
            onEnded={() => props.onEnded?.()}
            onLoadedMetadata={(e,) => props.onReady?.(e.currentTarget,)}
            playsinline
            preload={props.preload ?? 'metadata'}
            class={props.bare ? props.class : 'vp__video'}
            style={props.bare ? props.style : undefined}
        />
    );

    if (props.bare) return videoEl;

    return (
        <div
            ref={root}
            class={`vp${props.class ? ` ${props.class}` : ''}`}
            classList={{
                'vp--fresh': !st.started(),
                'vp--playing': !st.paused(),
                'vp--hidden': !controlsVisible(),
                'vp--fs': fs(),
                'vp--live': Boolean(props.live,),
            }}
            style={props.style}
            tabindex="0"
            role="region"
            aria-label={props.title || 'Video player'}
            onKeyDown={onKeyDown}
            onPointerMove={(e,) => e.pointerType === 'mouse' && poke()}
            onPointerLeave={(e,) => e.pointerType === 'mouse' && st.started() && hideNow()}
        >
            {videoEl}

            <div
                class="vp__surface"
                aria-hidden="true"
                onPointerDown={(e,) => {
                    lastPointer = e.pointerType;
                }}
                onPointerUp={onSurfacePointerUp}
                onClick={() => {
                    if (lastPointer !== 'mouse') return;
                    togglePlay();
                    poke();
                }}
                onDblClick={() => lastPointer === 'mouse' && toggleFs()}
            />

            <Show when={ripple()} keyed>
                {(r,) => (
                    <div class={`vp__ripple vp__ripple--${r.side}`} aria-hidden="true">
                        <span class="vp__ripple-label">
                            {r.side === 'left' ? <IconRewind /> : <IconForward />}
                            {r.seconds}s
                        </span>
                    </div>
                )}
            </Show>

            <Show when={st.waiting() && !st.error()}>
                <div class="vp__spinner" aria-hidden="true" />
            </Show>

            <Show when={!st.started() && !st.error()}>
                <button type="button" class="vp__bigplay" aria-label="Play" onClick={play}>
                    <IconPlay />
                </button>
            </Show>

            <Show when={props.live && st.started() && st.muted() && !st.error()}>
                <button type="button" class="vp__unmute" onClick={() => { toggleMute(); poke(); }}>
                    <IconVolumeMuted />
                    <span>Tap to unmute</span>
                </button>
            </Show>

            <Show when={st.error()}>
                {(msg,) => (
                    <div class="vp__error" role="alert">
                        <IconAlert />
                        <p>{msg()}</p>
                    </div>
                )}
            </Show>

            <Show when={showBar()}>
                <div
                    class="vp__controls"
                    onFocusIn={(e,) => {
                        let visible = true;
                        try {
                            visible = (e.target as HTMLElement).matches(':focus-visible',);
                        } catch {
                            // Old engine without :focus-visible — treat as keyboard.
                        }
                        setKbdFocus(visible,);
                    }}
                    onFocusOut={(e,) => {
                        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null,)) setKbdFocus(false,);
                    }}
                >
                    <Show when={!props.live}>
                        <SeekBar
                            video={() => video}
                            current={st.currentTime}
                            duration={st.duration}
                            buffered={st.buffered}
                            thumbnailsVtt={props.thumbnailsVtt}
                            onActiveChange={setSeekActive}
                        />
                    </Show>
                    <div class="vp__bar">
                        <div class="vp__group">
                            <button
                                type="button"
                                class="vp__btn vp__play"
                                aria-label={st.paused() ? 'Play' : 'Pause'}
                                onClick={togglePlay}
                            >
                                <Show when={st.paused()} fallback={<IconPause />}>
                                    <IconPlay />
                                </Show>
                            </button>
                            <VolumeControl
                                volume={st.volume}
                                muted={st.muted}
                                onVolume={setVolume}
                                onToggleMute={toggleMute}
                                onOpenChange={setVolOpen}
                            />
                            <Show when={props.live}>
                                <span class="vp__live-pill"><span class="vp__live-dot" aria-hidden="true" />LIVE</span>
                            </Show>
                            <Show when={!props.live}>
                                <button
                                    type="button"
                                    class="vp__btn vp__time"
                                    aria-label={remaining() ? 'Show elapsed time' : 'Show remaining time'}
                                    onClick={() => setRemaining(!remaining(),)}
                                >
                                    <span>
                                        {remaining()
                                            ? `-${formatTime(st.duration() - st.currentTime(),)}`
                                            : formatTime(st.currentTime(),)}
                                    </span>
                                    <span class="vp__time-sep">/</span>
                                    <span class="vp__time-total">{formatTime(st.duration(),)}</span>
                                </button>
                            </Show>
                        </div>
                        <div class="vp__group">
                            <Show when={!props.live}>
                                <SettingsMenu
                                    heights={heights}
                                    showQuality={() => heights().length > 1}
                                    quality={quality}
                                    autoHeight={autoHeight}
                                    onQuality={chooseQuality}
                                    rate={st.rate}
                                    onRate={(r,) => {
                                        if (video) video.playbackRate = r;
                                    }}
                                    onOpenChange={setMenuOpen}
                                />
                            </Show>
                            <Show when={pipOk()}>
                                <button
                                    type="button"
                                    class="vp__btn vp__pip"
                                    aria-label={pip() ? 'Exit picture-in-picture' : 'Picture-in-picture'}
                                    aria-pressed={pip()}
                                    onClick={() => void togglePip()}
                                >
                                    <IconPip />
                                </button>
                            </Show>
                            <Show when={fsOk()}>
                                <button
                                    type="button"
                                    class="vp__btn vp__fs"
                                    aria-label={fs() ? 'Exit fullscreen' : 'Fullscreen'}
                                    onClick={toggleFs}
                                >
                                    <Show when={fs()} fallback={<IconFullscreen />}>
                                        <IconFullscreenExit />
                                    </Show>
                                </button>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default VideoPlayer;
