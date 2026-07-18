import type { SiteSwatch, } from '@sitesurge/types';
import { createEffect, createMemo, For, onCleanup, Show, } from 'solid-js';
import { createSignal, } from 'solid-js';
import {
    buildSwatchRef,
    colorCssValue,
    isSwatchRef,
    resolveColorReactive,
    swatchRefId,
} from '../../../services/colorResolver';
import { loadSwatches, swatches, } from '../../../services/siteColors';
import './ColorPicker.scss';

interface ColorPickerProps {
    /** Stored value — either a raw hex (`#abc123`), a swatch reference
     *  (`swatch:abc123`), or empty/`'none'`/`'transparent'` for cleared. */
    value: string;
    /** Called whenever the value changes. The argument is whatever the
     *  user produced: a swatch reference if they picked from the
     *  palette, or a raw hex if they typed/pasted/used the wheel. */
    onChange: (value: string,) => void;
    /** Show a "no color" / transparent clear button. Default false. */
    clearable?: boolean;
    /** Called when the user clicks the clear button. */
    onClear?: () => void;
    showHexInput?: boolean;
    /** Hex used to render previews when the value is empty or unresolvable. */
    defaultColor?: string;
    /** When true, the text inputs accept ANY CSS value (hex, rgb/rgba, hsl,
     *  `linear-gradient(...)`, etc.) instead of validating for hex only. The
     *  raw string is passed through to `onChange` and applied verbatim by the
     *  consumer (e.g. the header uses it as `background`). Swatch links still
     *  work; typing a literal value unlinks. Default false. */
    allowCustomValue?: boolean;
}

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
function isValidHex(hex: string,): boolean { return HEX_RE.test(hex,); }

/** True for empty / "no color" markers. Mirrors `colorResolver.isEmptyColor`
 *  but inlined here so we don't need to import for a 4-line check. */
function isEmpty(val: string | undefined | null,): boolean {
    return !val || val === '' || val === 'transparent' || val === 'none';
}

export default function ColorPicker(props: ColorPickerProps,) {
    const defaultColor = () => props.defaultColor || '#ffffff';
    const [open, setOpen,] = createSignal(false,);
    const [popupPos, setPopupPos,] = createSignal({ top: 0, left: 0, },);
    let containerRef: HTMLDivElement | undefined;
    let swatchRef: HTMLButtonElement | undefined;

    void loadSwatches();

    // ─── Derived state ───
    const isCleared = () => isEmpty(props.value,);
    const isRef = () => isSwatchRef(props.value,);
    const refId = () => swatchRefId(props.value,);

    /** Resolved hex used for previews (the swatch button background, the
     *  active state on a preset). Reactive — updates when the swatch
     *  palette changes. */
    const resolvedHex = createMemo(() => resolveColorReactive(props.value, defaultColor(),));

    /** What goes in the hex input. For swatch refs we DON'T spam the
     *  user with the resolved hex — that hides the link. We show empty
     *  string and rely on the chain-link badge to communicate the
     *  ref. For raw hex we mirror the value. For empty, blank. */
    const hexInputValue = () => {
        if (isCleared()) return '';
        if (isRef()) return '';
        return props.value || '';
    };

    /** Currently active swatch ID, if any (for highlighting in the grid). */
    const activeSwatchId = () => refId();

    // ─── Handlers ───

    const handleHexChange = (val: string,) => {
        let v = val.trim();
        if (v && !v.startsWith('#',)) v = '#' + v;
        // Typing a hex always clears any swatch reference — the user
        // is now expressing a literal value, not a link.
        if (isValidHex(v,)) {
            props.onChange(v,);
        } else if (v === '') {
            // Allow clearing through the input; let the parent decide
            // how to treat empty (most fields use clearable+onClear).
            if (props.clearable && props.onClear) props.onClear();
            else props.onChange('',);
        }
        // Invalid intermediate states — don't propagate; the input
        // shows its own "invalid" styling until the user finishes.
    };

    /** Custom-value mode: pass the raw string through untouched (no `#`
     *  prefixing, no hex validation) so gradients / rgba / hsl reach the
     *  consumer as-is. Empty clears. */
    const handleCustomChange = (val: string,) => {
        const v = val.trim();
        if (v === '') {
            if (props.clearable && props.onClear) props.onClear();
            else props.onChange('',);
            return;
        }
        props.onChange(v,);
    };

    /** Route text-input changes to the right handler based on mode. */
    const handleTextInput = (val: string,) => {
        if (props.allowCustomValue) handleCustomChange(val,);
        else handleHexChange(val,);
    };

    const selectSwatch = (s: SiteSwatch,) => {
        // Preset clicks emit a swatch REFERENCE, not the raw hex.
        // That's the whole point of this system — references track
        // the swatch as it changes. Users who want a literal value
        // type it in the hex input below the grid.
        props.onChange(buildSwatchRef(s.id,),);
        setOpen(false,);
    };

    const handleClear = () => {
        setOpen(false,);
        if (props.onClear) {
            props.onClear();
        } else {
            props.onChange('',);
        }
    };

    // ─── Outside-click + scroll close ───
    const handleClickOutside = (e: MouseEvent,) => {
        if (containerRef && !containerRef.contains(e.target as Node,)) {
            setOpen(false,);
        }
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside,);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside,));
    }

    // Force re-position when opening (window may have scrolled since
    // last open). Done via createEffect so the popup tracks scroll
    // / resize implicitly through the next open click.
    createEffect(() => {
        if (open() && swatchRef) {
            const rect = swatchRef.getBoundingClientRect();
            setPopupPos({ top: rect.bottom + 4, left: rect.left, },);
        }
    },);

    return (
        <div class="color-picker" ref={containerRef}>
            <Show when={props.showHexInput !== false}>
                <input
                    type="text"
                    class={`color-picker__hex-input ${
                        props.allowCustomValue ? 'color-picker__hex-input--wide' : ''
                    } ${
                        !props.allowCustomValue && !isCleared() && !isRef() && !isValidHex(hexInputValue(),) ?
                            'color-picker__hex-input--invalid' : ''
                    }`}
                    value={hexInputValue()}
                    onChange={(e,) => handleTextInput(e.currentTarget.value,)}
                    placeholder={isRef()
                        ? `swatch:${refId()}`
                        : props.allowCustomValue
                        ? '#hex, rgba(), gradient…'
                        : (props.clearable ? 'None' : '#ffffff')}
                    maxLength={props.allowCustomValue ? undefined : 7}
                    title={isRef()
                        ? `Linked to swatch '${refId()}' — type a ${props.allowCustomValue ? 'value' : 'hex'} to unlink`
                        : undefined}
                />
            </Show>
            <button
                ref={swatchRef}
                type="button"
                class={`color-picker__swatch ${
                    isCleared() ? 'color-picker__swatch--empty' : ''
                } ${isRef() ? 'color-picker__swatch--linked' : ''}`}
                style={isCleared() ? {} : {
                    // Use colorCssValue so the swatch button itself
                    // tracks live updates if the linked palette entry
                    // changes color.
                    background: colorCssValue(props.value, defaultColor(),),
                }}
                onClick={() => setOpen(!open(),)}
                title={
                    isCleared() ? 'No color — click to pick' :
                    isRef() ? `Linked to swatch '${refId()}' (${resolvedHex()}) — click to change` :
                    'Pick color'
                }
            >
                <Show when={isRef()}>
                    {/* Tiny chain-link icon overlay so users can see at
                        a glance which fields are linked vs. literal. */}
                    <span class="color-picker__link-badge" aria-label="Linked to swatch">⛓</span>
                </Show>
            </button>
            <Show when={open()}>
                <div
                    class="color-picker__popup"
                    style={{
                        position: 'fixed',
                        top: `${popupPos().top}px`,
                        left: `${popupPos().left}px`,
                    }}
                >
                    <div class="color-picker__popup-header">
                        <span class="color-picker__popup-title">Site swatches</span>
                        <span class="color-picker__popup-hint">Click to link · type below to unlink</span>
                    </div>
                    <div class="color-picker__presets">
                        <Show when={props.clearable}>
                            <button
                                type="button"
                                class={`color-picker__preset color-picker__preset--none ${
                                    isCleared() ? 'color-picker__preset--active' : ''
                                }`}
                                onClick={handleClear}
                                title="No color"
                            />
                        </Show>
                        <For each={swatches()}>
                            {(s,) => (
                                <button
                                    type="button"
                                    class={`color-picker__preset ${
                                        activeSwatchId() === s.id ? 'color-picker__preset--active' : ''
                                    }`}
                                    style={{ background: s.hex, }}
                                    onClick={() => selectSwatch(s,)}
                                    title={s.name ? `${s.name} (${s.id} · ${s.hex})` : `${s.id} · ${s.hex}`}
                                >
                                    <span class="color-picker__preset-id">{s.id}</span>
                                </button>
                            )}
                        </For>
                    </div>
                    <div class="color-picker__custom">
                        <label>{props.allowCustomValue ? 'Custom value:' : 'Custom hex:'}</label>
                        <input
                            type="text"
                            value={isRef() || isCleared() ? '' : (props.value || '')}
                            onChange={(e,) => handleTextInput(e.currentTarget.value,)}
                            placeholder={props.allowCustomValue ? 'linear-gradient(…), rgba(…), #hex' : '#000000'}
                            maxLength={props.allowCustomValue ? undefined : 7}
                        />
                        <Show when={props.allowCustomValue}>
                            <small class="color-picker__custom-hint">
                                Any CSS background: hex, rgb/rgba, hsl, or linear/radial-gradient.
                            </small>
                        </Show>
                    </div>
                </div>
            </Show>
        </div>
    );
}
