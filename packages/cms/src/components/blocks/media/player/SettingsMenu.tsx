/**
 * Settings (gear) menu: Quality (HLS levels, "Auto (720p)" showing the level
 * ABR picked) and Playback speed. A menu-button: focus moves into the menu on
 * open, ↑/↓/Home/End move between items, ←/Backspace go back from a sub-page,
 * Esc closes and returns focus to the gear, a click outside closes.
 */
import { Component, createEffect, createSignal, For, onCleanup, Show, } from 'solid-js';
import { IconCheck, IconChevronLeft, IconChevronRight, IconSettings, } from './icons';

interface SettingsMenuProps {
    /** Distinct level heights, highest first. */
    heights: () => number[];
    showQuality: () => boolean;
    /** Selected height; 0 = Auto. */
    quality: () => number;
    /** Height ABR is currently playing (for "Auto (720p)"). */
    autoHeight: () => number | null;
    onQuality: (height: number,) => void;
    rate: () => number;
    onRate: (rate: number,) => void;
    onOpenChange: (open: boolean,) => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,];
type Page = 'main' | 'quality' | 'speed';

const SettingsMenu: Component<SettingsMenuProps> = (props,) => {
    let wrap: HTMLDivElement | undefined;
    let btn: HTMLButtonElement | undefined;
    let menu: HTMLDivElement | undefined;
    const [open, setOpen,] = createSignal(false,);
    const [page, setPage,] = createSignal<Page>('main',);
    createEffect(() => props.onOpenChange(open(),),);

    const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]',) ?? []),];
    const focusFirst = () =>
        queueMicrotask(() => {
            const list = items();
            (list.find((i,) => i.getAttribute('aria-checked',) === 'true') ?? list[0])?.focus();
        },);

    const close = (returnFocus: boolean,) => {
        setOpen(false,);
        setPage('main',);
        if (returnFocus) btn?.focus();
    };
    const go = (p: Page,) => {
        setPage(p,);
        focusFirst();
    };

    createEffect(() => {
        if (!open()) return;
        const onDown = (e: PointerEvent,) => {
            if (!wrap?.contains(e.target as Node,)) close(false,);
        };
        document.addEventListener('pointerdown', onDown, true,);
        onCleanup(() => document.removeEventListener('pointerdown', onDown, true,));
    },);

    const onMenuKey = (e: KeyboardEvent,) => {
        const list = items();
        const idx = list.indexOf(document.activeElement as HTMLElement,);
        const move = (i: number,) => list[(i + list.length) % list.length]?.focus();
        switch (e.key) {
            case 'Escape':
                close(true,);
                break;
            case 'ArrowDown':
                move(idx + 1,);
                break;
            case 'ArrowUp':
                move(idx - 1,);
                break;
            case 'Home':
                move(0,);
                break;
            case 'End':
                move(list.length - 1,);
                break;
            case 'ArrowLeft':
            case 'Backspace':
                if (page() === 'main') return;
                go('main',);
                break;
            case 'Tab':
                close(false,);
                return;
            default:
                return;
        }
        e.preventDefault();
        e.stopPropagation();
    };

    const qualityLabel = (h: number,) => {
        if (h) return `${h}p`;
        const a = props.autoHeight();
        return a ? `Auto (${a}p)` : 'Auto';
    };
    const rateLabel = (r: number,) => (r === 1 ? 'Normal' : `${r}×`);

    const Radio = (p: { label: string; checked: boolean; onSelect: () => void; },) => (
        <button
            type="button"
            role="menuitemradio"
            tabindex="-1"
            aria-checked={p.checked}
            class="vp-settings__item vp-settings__item--radio"
            onClick={() => {
                p.onSelect();
                close(true,);
            }}
        >
            <span class="vp-settings__check"><IconCheck /></span>
            <span class="vp-settings__label">{p.label}</span>
        </button>
    );

    const Back = (p: { label: string; },) => (
        <button type="button" role="menuitem" tabindex="-1" class="vp-settings__item vp-settings__head" onClick={() => go('main',)}>
            <IconChevronLeft />
            <span class="vp-settings__label">{p.label}</span>
        </button>
    );

    return (
        <div ref={wrap} class="vp-settings" classList={{ 'vp-settings--speed-only': !props.showQuality(), }}>
            <button
                ref={btn}
                type="button"
                class="vp__btn vp-settings__btn"
                classList={{ 'vp-settings__btn--open': open(), }}
                aria-label="Settings"
                aria-haspopup="menu"
                aria-expanded={open()}
                onClick={() => {
                    if (open()) close(false,);
                    else {
                        setPage('main',);
                        setOpen(true,);
                        focusFirst();
                    }
                }}
            >
                <IconSettings />
            </button>
            <Show when={open()}>
                <div ref={menu} class="vp-settings__menu" role="menu" aria-label="Settings" onKeyDown={onMenuKey}>
                    <Show when={page() === 'main'}>
                        <Show when={props.showQuality()}>
                            <button type="button" role="menuitem" tabindex="-1" class="vp-settings__item" onClick={() => go('quality',)}>
                                <span class="vp-settings__label">Quality</span>
                                <span class="vp-settings__value">{qualityLabel(props.quality(),)}<IconChevronRight /></span>
                            </button>
                        </Show>
                        <button type="button" role="menuitem" tabindex="-1" class="vp-settings__item" onClick={() => go('speed',)}>
                            <span class="vp-settings__label">Playback speed</span>
                            <span class="vp-settings__value">{rateLabel(props.rate(),)}<IconChevronRight /></span>
                        </button>
                    </Show>
                    <Show when={page() === 'quality'}>
                        <Back label="Quality" />
                        <For each={[0, ...props.heights(),]}>
                            {(h,) => (
                                <Radio label={qualityLabel(h,)} checked={props.quality() === h} onSelect={() => props.onQuality(h,)} />
                            )}
                        </For>
                    </Show>
                    <Show when={page() === 'speed'}>
                        <Back label="Playback speed" />
                        <For each={RATES}>
                            {(r,) => <Radio label={rateLabel(r,)} checked={props.rate() === r} onSelect={() => props.onRate(r,)} />}
                        </For>
                    </Show>
                </div>
            </Show>
        </div>
    );
};

export default SettingsMenu;
