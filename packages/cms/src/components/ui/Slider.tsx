/**
 * Slider — a styled `<input type="range">` with its live value shown beside it.
 *
 * Holds a LOCAL draft while the thumb moves (`onInput` fires per step for a
 * live readout only); the value is lifted via `onCommit` on `change` — the
 * pointer release, or each keyboard step — so a parent store is never written
 * per pixel of a drag. Syncs back from `value` only while not being dragged.
 *
 * Component-scoped styles (`Slider.scss`) so it works in the admin AND on the
 * public site. The track fill shows progress via the `--slider-pct` variable.
 *
 *   <Slider value={pct()} min={1} max={100} suffix="%" onCommit={setPct} />
 */
import { Component, createEffect, createSignal, } from 'solid-js';
import './Slider.scss';

export interface SliderProps {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    /** Called on release (pointer) or each keyboard change. */
    onCommit: (v: number,) => void;
    /** Optional live callback while dragging — must not write a store. */
    onInput?: (v: number,) => void;
    /** Appended to the shown value, e.g. '%'. */
    suffix?: string;
    disabled?: boolean;
    /** Accessible name (used when no visible label is associated). */
    label?: string;
    ariaLabel?: string;
    class?: string;
}

export const Slider: Component<SliderProps> = (p,) => {
    const min = () => p.min ?? 0;
    const max = () => p.max ?? 100;
    const [draft, setDraft,] = createSignal(p.value,);
    let dragging = false;

    createEffect(() => {
        const v = p.value;
        if (!dragging) setDraft(v,);
    },);

    const pct = () => {
        const span = max() - min();
        if (span <= 0) return 0;
        return Math.min(100, Math.max(0, ((draft() - min()) / span) * 100,),);
    };

    const read = (e: Event,): number => Number((e.currentTarget as HTMLInputElement).value,);

    return (
        <span class={`ui-slider ${p.disabled ? 'ui-slider--disabled' : ''} ${p.class ?? ''}`}>
            <input
                type="range"
                class="ui-slider__input"
                min={min()}
                max={max()}
                step={p.step ?? 1}
                value={draft()}
                disabled={p.disabled}
                aria-label={p.ariaLabel ?? p.label}
                aria-valuetext={`${draft()}${p.suffix ?? ''}`}
                style={{ '--slider-pct': `${pct()}%`, }}
                onPointerDown={() => { dragging = true; }}
                onInput={(e,) => {
                    const v = read(e,);
                    setDraft(v,);
                    p.onInput?.(v,);
                }}
                onChange={(e,) => {
                    dragging = false;
                    const v = read(e,);
                    setDraft(v,);
                    if (v !== p.value) p.onCommit(v,);
                }}
                onBlur={() => { dragging = false; }}
            />
            <output class="ui-slider__value">{draft()}{p.suffix ?? ''}</output>
        </span>
    );
};

export default Slider;
