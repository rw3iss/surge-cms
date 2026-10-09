/**
 * Seek bar: thin rail that thickens on hover, buffered ranges, played fill,
 * a thumb shown on hover/drag/focus, and a hover tooltip with the time plus a
 * sprite preview frame when a thumbnails VTT is given (loaded on first hover).
 *
 * Pointer events with capture cover mouse + touch drags; playback pauses while
 * scrubbing and resumes after. Keyboard: role=slider, ←/→ ±5s, PgUp/PgDn ±10%,
 * Home/End.
 */
import { Component, createEffect, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import { type BufferedRange, formatTime, } from './useVideoState';
import { findCue, loadThumbnails, type ThumbCue, } from './vtt';

interface SeekBarProps {
    video: () => HTMLVideoElement | undefined;
    current: () => number;
    duration: () => number;
    buffered: () => readonly BufferedRange[];
    thumbnailsVtt?: string;
    /** Hovered, dragged or focused — the player keeps its controls up. */
    onActiveChange: (active: boolean,) => void;
}

/** Widest preview frame, px. */
const FRAME_MAX_W = 168;
const clamp = (n: number, lo: number, hi: number,) => Math.min(hi, Math.max(lo, n,),);

const SeekBar: Component<SeekBarProps> = (props,) => {
    let el: HTMLDivElement | undefined;
    const [hoverX, setHoverX,] = createSignal<number | null>(null,);
    const [width, setWidth,] = createSignal(0,);
    const [drag, setDrag,] = createSignal<number | null>(null,);
    const [focused, setFocused,] = createSignal(false,);
    const [cues, setCues,] = createSignal<ThumbCue[] | null>(null,);

    let requested = '';
    const ensureThumbs = () => {
        const url = props.thumbnailsVtt;
        if (!url || requested === url) return;
        requested = url;
        void loadThumbnails(url,).then((c,) => {
            if (props.thumbnailsVtt === url) setCues(c,);
        },);
    };
    createEffect(on(() => props.thumbnailsVtt, () => {
        requested = '';
        setCues(null,);
    }, { defer: true, },),);

    const dur = () => props.duration() || 0;
    const shown = () => drag() ?? props.current();
    const pct = (t: number,) => (dur() ? clamp(t / dur(), 0, 1,) * 100 : 0);

    createEffect(() => props.onActiveChange(hoverX() !== null || drag() !== null || focused(),),);

    // Coalesce drag seeks to one per frame.
    let pendingSeek: number | null = null;
    let seekRaf = 0;
    const seekTo = (t: number,) => {
        pendingSeek = t;
        if (seekRaf) return;
        seekRaf = requestAnimationFrame(() => {
            seekRaf = 0;
            const v = props.video();
            if (v && pendingSeek !== null) v.currentTime = pendingSeek;
            pendingSeek = null;
        },);
    };
    onCleanup(() => cancelAnimationFrame(seekRaf,),);

    const at = (clientX: number,) => {
        const r = el!.getBoundingClientRect();
        setWidth(r.width,);
        const x = clamp(clientX - r.left, 0, r.width,);
        return { x, t: r.width ? (x / r.width) * dur() : 0, };
    };

    let resumeAfterDrag = false;
    const onPointerDown = (e: PointerEvent,) => {
        if ((e.pointerType === 'mouse' && e.button !== 0) || !dur()) return;
        e.preventDefault();
        el!.setPointerCapture(e.pointerId,);
        ensureThumbs();
        const v = props.video();
        resumeAfterDrag = Boolean(v && !v.paused,);
        v?.pause();
        const { x, t, } = at(e.clientX,);
        setHoverX(x,);
        setDrag(t,);
        seekTo(t,);
    };
    const onPointerMove = (e: PointerEvent,) => {
        if (!dur()) return;
        const { x, t, } = at(e.clientX,);
        if (drag() !== null) {
            setDrag(t,);
            setHoverX(x,);
            seekTo(t,);
        } else if (e.pointerType === 'mouse') {
            setHoverX(x,);
            ensureThumbs();
        }
    };
    const onPointerEnd = (e: PointerEvent,) => {
        const t = drag();
        if (t === null) return;
        if (el!.hasPointerCapture(e.pointerId,)) el!.releasePointerCapture(e.pointerId,);
        seekTo(t,);
        setDrag(null,);
        if (e.pointerType !== 'mouse') setHoverX(null,);
        if (resumeAfterDrag) void props.video()?.play().catch(() => {},);
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        const v = props.video();
        if (!v || !dur()) return;
        let t: number | null = null;
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                t = v.currentTime - 5;
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                t = v.currentTime + 5;
                break;
            case 'PageDown':
                t = v.currentTime - dur() * 0.1;
                break;
            case 'PageUp':
                t = v.currentTime + dur() * 0.1;
                break;
            case 'Home':
                t = 0;
                break;
            case 'End':
                t = dur();
                break;
        }
        if (t === null) return;
        e.preventDefault();
        e.stopPropagation();
        v.currentTime = clamp(t, 0, dur(),);
    };

    const hoverTime = () => {
        const x = hoverX();
        return x !== null && width() ? (x / width()) * dur() : null;
    };
    const cue = () => {
        const c = cues();
        const t = hoverTime();
        return c && t !== null ? findCue(c, t,) : null;
    };
    const frameScale = (c: ThumbCue,) => Math.min(1, FRAME_MAX_W / c.w,);
    const tipLeft = () => {
        const c = cue();
        const half = (c ? (c.w ? c.w * frameScale(c,) : FRAME_MAX_W) : 48) / 2 + 4;
        return clamp(hoverX() ?? 0, half, Math.max(half, width() - half,),);
    };

    return (
        <div
            ref={el}
            class="vp-seek"
            classList={{
                'vp-seek--active': hoverX() !== null || drag() !== null,
                'vp-seek--dragging': drag() !== null,
            }}
            role="slider"
            tabindex="0"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(dur(),)}
            aria-valuenow={Math.round(shown(),)}
            aria-valuetext={`${formatTime(shown(),)} of ${formatTime(dur(),)}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onPointerLeave={() => {
                if (drag() === null) setHoverX(null,);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true,)}
            onBlur={() => setFocused(false,)}
        >
            <div class="vp-seek__rail">
                <For each={props.buffered()}>
                    {(r,) => (
                        <div
                            class="vp-seek__buffered"
                            style={{ left: `${pct(r[0],)}%`, width: `${pct(r[1],) - pct(r[0],)}%`, }}
                        />
                    )}
                </For>
                <Show when={hoverTime() !== null && drag() === null}>
                    <div class="vp-seek__hover" style={{ width: `${pct(hoverTime()!,)}%`, }} />
                </Show>
                <div class="vp-seek__played" style={{ width: `${pct(shown(),)}%`, }} />
            </div>
            <div class="vp-seek__thumb" style={{ left: `${pct(shown(),)}%`, }} />
            <Show when={hoverTime() !== null}>
                <div class="vp-seek__tip" style={{ left: `${tipLeft()}px`, }} aria-hidden="true">
                    <Show when={cue()} keyed>
                        {(c,) => (
                            <div class="vp-seek__frame">
                                <Show
                                    when={c.w > 0}
                                    fallback={<img class="vp-seek__frame-full" src={c.url} alt="" draggable={false} />}
                                >
                                    <div style={{ width: `${c.w * frameScale(c,)}px`, height: `${c.h * frameScale(c,)}px`, }}>
                                        <div
                                            class="vp-seek__frame-img"
                                            style={{
                                                width: `${c.w}px`,
                                                height: `${c.h}px`,
                                                'background-image': `url("${c.url}")`,
                                                'background-position': `-${c.x}px -${c.y}px`,
                                                transform: `scale(${frameScale(c,)})`,
                                            }}
                                        />
                                    </div>
                                </Show>
                            </div>
                        )}
                    </Show>
                    <span class="vp-seek__time">{formatTime(hoverTime()!,)}</span>
                </div>
            </Show>
        </div>
    );
};

export default SeekBar;
