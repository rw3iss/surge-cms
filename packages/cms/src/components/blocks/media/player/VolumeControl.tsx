/**
 * Volume: the speaker icon (muted / low / high) toggles mute on click. On
 * hover (desktop) or keyboard focus a VERTICAL slider panel slides up above it.
 * On touch, tapping the icon opens/closes the panel instead, and muting is a
 * button inside the panel.
 */
import { Component, createEffect, createSignal, onCleanup, Show, } from 'solid-js';
import { IconVolumeHigh, IconVolumeLow, IconVolumeMuted, } from './icons';

interface VolumeControlProps {
    volume: () => number;
    muted: () => boolean;
    onVolume: (v: number,) => void;
    onToggleMute: () => void;
    /** The panel is open — the player keeps its controls up. */
    onOpenChange: (open: boolean,) => void;
}

const clamp01 = (n: number,) => Math.min(1, Math.max(0, n,),);

const VolumeControl: Component<VolumeControlProps> = (props,) => {
    let wrap: HTMLDivElement | undefined;
    let slider: HTMLDivElement | undefined;
    const [hover, setHover,] = createSignal(false,);
    const [pinned, setPinned,] = createSignal(false,);
    const [dragging, setDragging,] = createSignal(false,);
    const [focusIn, setFocusIn,] = createSignal(false,);
    const open = () => hover() || pinned() || dragging() || focusIn();
    createEffect(() => props.onOpenChange(open(),),);

    const level = () => (props.muted() ? 0 : props.volume());

    // Touch-opened panel closes on a tap anywhere else.
    createEffect(() => {
        if (!pinned()) return;
        const onDown = (e: PointerEvent,) => {
            if (!wrap?.contains(e.target as Node,)) setPinned(false,);
        };
        document.addEventListener('pointerdown', onDown, true,);
        onCleanup(() => document.removeEventListener('pointerdown', onDown, true,));
    },);

    let lastPointer = '';
    const onIconClick = (e: MouseEvent,) => {
        // detail === 0 → keyboard activation, which always means mute.
        if (e.detail !== 0 && lastPointer !== 'mouse' && lastPointer !== '') {
            setPinned(!pinned(),);
            return;
        }
        props.onToggleMute();
    };

    const fromPointer = (clientY: number,) => {
        const r = slider!.getBoundingClientRect();
        props.onVolume(clamp01(1 - (clientY - r.top) / r.height,),);
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        const v = level();
        let next: number | null = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = v + 0.05;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = v - 0.05;
        else if (e.key === 'PageUp') next = v + 0.2;
        else if (e.key === 'PageDown') next = v - 0.2;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = 1;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        props.onVolume(clamp01(next,),);
    };

    const Icon = () => (
        <Show when={level() > 0} fallback={<IconVolumeMuted />}>
            <Show when={level() >= 0.5} fallback={<IconVolumeLow />}>
                <IconVolumeHigh />
            </Show>
        </Show>
    );

    return (
        <div
            ref={wrap}
            class="vp-volume"
            classList={{ 'vp-volume--open': open(), }}
            onPointerEnter={(e,) => e.pointerType === 'mouse' && setHover(true,)}
            onPointerLeave={(e,) => e.pointerType === 'mouse' && setHover(false,)}
            onFocusIn={() => setFocusIn(true,)}
            onFocusOut={(e,) => {
                if (!wrap?.contains(e.relatedTarget as Node | null,)) setFocusIn(false,);
            }}
        >
            <button
                type="button"
                class="vp__btn"
                aria-label={props.muted() ? 'Unmute' : 'Mute'}
                aria-expanded={pinned()}
                onPointerDown={(e,) => {
                    lastPointer = e.pointerType;
                }}
                onClick={onIconClick}
            >
                <Icon />
            </button>
            <div class="vp-volume__panel">
                <div class="vp-volume__box">
                    <div
                        ref={slider}
                        class="vp-volume__slider"
                        role="slider"
                        tabindex="0"
                        aria-label="Volume"
                        aria-orientation="vertical"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(level() * 100,)}
                        aria-valuetext={props.muted() ? 'Muted' : `${Math.round(level() * 100,)}%`}
                        onPointerDown={(e,) => {
                            if (e.pointerType === 'mouse' && e.button !== 0) return;
                            e.preventDefault();
                            slider!.setPointerCapture(e.pointerId,);
                            setDragging(true,);
                            fromPointer(e.clientY,);
                        }}
                        onPointerMove={(e,) => dragging() && fromPointer(e.clientY,)}
                        onPointerUp={(e,) => {
                            if (slider!.hasPointerCapture(e.pointerId,)) slider!.releasePointerCapture(e.pointerId,);
                            setDragging(false,);
                        }}
                        onPointerCancel={() => setDragging(false,)}
                        onKeyDown={onKeyDown}
                    >
                        <div class="vp-volume__rail">
                            <div class="vp-volume__fill" style={{ height: `${level() * 100}%`, }} />
                        </div>
                        <div class="vp-volume__knob" style={{ bottom: `${level() * 100}%`, }} />
                    </div>
                    <Show when={pinned()}>
                        <button
                            type="button"
                            class="vp__btn vp-volume__mute"
                            aria-label={props.muted() ? 'Unmute' : 'Mute'}
                            onClick={() => props.onToggleMute()}
                        >
                            <Icon />
                        </button>
                    </Show>
                </div>
            </div>
        </div>
    );
};

export default VolumeControl;
