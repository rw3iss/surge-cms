/**
 * FontSelect — a custom dropdown for choosing one of the site's uploaded
 * fonts. Each option is rendered IN its own font so the operator previews the
 * real typeface, labelled `Family Name (customId)`. The selected value is the
 * font's `customId` (the `font-family` token used everywhere), or `''` for the
 * inherited/default font.
 *
 * Reusable across the admin (Appearance, Site Header, Site Footer, block
 * styles). Ensures the uploaded fonts' @font-face rules are injected on mount
 * so previews render even outside the Font Manager panel.
 */
import { Component, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { ensureFontFaces, type Font, fonts as fontsSignal, } from '../../../services/fonts';
import './FontSelect.scss';

interface FontSelectProps {
    /** Selected font `customId`, or '' for the inherited/default font. */
    value: string;
    onChange: (customId: string,) => void;
    /** Label for the "no explicit font" option. Default 'Default (inherit)'. */
    noneLabel?: string;
    class?: string;
    disabled?: boolean;
}

const displayName = (f: Font,) => f.familyName || f.originalName || f.customId;

const FontSelect: Component<FontSelectProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    let rootEl: HTMLDivElement | undefined;

    const list = () => fontsSignal();
    const noneLabel = () => props.noneLabel ?? 'Default (inherit)';
    const selected = createMemo(() => list().find(f => f.customId === props.value) || null,);

    const onDocClick = (e: MouseEvent,) => {
        if (open() && rootEl && !rootEl.contains(e.target as Node,)) setOpen(false,);
    };
    const onKey = (e: KeyboardEvent,) => { if (e.key === 'Escape') setOpen(false,); };

    onMount(() => {
        void ensureFontFaces();
        document.addEventListener('click', onDocClick,);
        document.addEventListener('keydown', onKey,);
    },);
    onCleanup(() => {
        document.removeEventListener('click', onDocClick,);
        document.removeEventListener('keydown', onKey,);
    },);

    const pick = (customId: string,) => { props.onChange(customId,); setOpen(false,); };

    return (
        <div class={`font-select ${props.class ?? ''}`} ref={(el,) => { rootEl = el; }}>
            <button
                type="button"
                class="font-select__trigger"
                disabled={props.disabled}
                aria-haspopup="listbox"
                aria-expanded={open()}
                onClick={(e,) => { e.stopPropagation(); setOpen(!open(),); }}
            >
                <Show
                    when={selected()}
                    fallback={<span class="font-select__placeholder">{noneLabel()}</span>}
                >
                    {(f,) => (
                        <span class="font-select__value" style={{ 'font-family': `'${f().customId}', system-ui, sans-serif`, }}>
                            {displayName(f(),)} <span class="font-select__id">({f().customId})</span>
                        </span>
                    )}
                </Show>
                <svg class="font-select__caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </button>
            <Show when={open()}>
                <div class="font-select__menu" role="listbox">
                    <button
                        type="button"
                        class={`font-select__option ${!props.value ? 'font-select__option--active' : ''}`}
                        onClick={() => pick('',)}
                    >
                        <span class="font-select__placeholder">{noneLabel()}</span>
                    </button>
                    <For each={list()}>
                        {(f,) => (
                            <button
                                type="button"
                                class={`font-select__option ${props.value === f.customId ? 'font-select__option--active' : ''}`}
                                style={{ 'font-family': `'${f.customId}', system-ui, sans-serif`, }}
                                onClick={() => pick(f.customId,)}
                            >
                                {displayName(f,)} <span class="font-select__id">({f.customId})</span>
                            </button>
                        )}
                    </For>
                    <Show when={list().length === 0}>
                        <div class="font-select__empty">No fonts uploaded. Add fonts in Settings → Appearance.</div>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default FontSelect;
