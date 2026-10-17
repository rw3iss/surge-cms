/**
 * EntityTypeSelect — searchable single-select over EVERY entity type
 * (`cms.entityTypes.list()`: core, feature-owned and custom).
 *
 * Closed, it shows the chosen type's label + key. Open, a Portal popover with a
 * filter box (matches label and key) and one row per type: label, key and an
 * origin hint. Same placement recipe as `ui/MultiSelect` — Portal (escapes
 * clipping ancestors) + `computeMenuPlacement` (flips above when cramped) —
 * and the same window-level keyboard/outside-click handling, since a Portal
 * moves the popover out of the wrapper's subtree.
 *
 * The filter box is search-as-you-type by design: it only narrows the list and
 * never produces a committed value, so the commit-on-blur rule does not apply.
 *
 *   <EntityTypeSelect value={key()} onChange={setKey} />
 */
import type { EntityTypeDef, } from '@sitesurge/types';
import { Component, createMemo, createResource, createSignal, createUniqueId, For, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { cms, } from '../../../services/cmsClient';
import { computeMenuPlacement, type MenuPlacement, } from '../../../utils/menuPlacement';
import './EntityTypeSelect.scss';

export interface EntityTypeSelectProps {
    value: string;
    onChange: (key: string,) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Narrows the offered types (e.g. only ones with a slug). */
    filter?: (type: EntityTypeDef,) => boolean;
    id?: string;
    ariaLabel?: string;
}

const POPOVER_OFFSET_PX = 4;
const POPOVER_MIN_WIDTH = 240;
const POPOVER_MAX_HEIGHT_VH = 50;
const POPOVER_MIN_USABLE_PX = 160;

/** Types matching `q` on label or key (case-insensitive), label-sorted. */
export function filterEntityTypes(types: EntityTypeDef[], q: string,): EntityTypeDef[] {
    const needle = q.trim().toLowerCase();
    const sorted = types.toSorted((a, b,) => a.label.localeCompare(b.label,));
    if (!needle) return sorted;
    return sorted.filter((t,) => t.label.toLowerCase().includes(needle,) || t.key.toLowerCase().includes(needle,));
}

const EntityTypeSelect: Component<EntityTypeSelectProps> = (props,) => {
    const listboxId = `entity-type-select-${createUniqueId()}`;
    const optionId = (i: number,) => `${listboxId}-opt-${i}`;

    const [types,] = createResource(async () => {
        try {
            return await cms.entityTypes.list();
        } catch {
            return [] as EntityTypeDef[];
        }
    },);

    const [open, setOpen,] = createSignal(false,);
    const [search, setSearch,] = createSignal('',);
    const [activeIndex, setActiveIndex,] = createSignal(-1,);
    const [pos, setPos,] = createSignal<MenuPlacement>(
        { placement: 'below', top: 0, bottom: 0, left: 0, maxHeight: 280, },
    );
    const [width, setWidth,] = createSignal(POPOVER_MIN_WIDTH,);

    let controlRef: HTMLDivElement | undefined;
    let popoverRef: HTMLDivElement | undefined;
    let searchRef: HTMLInputElement | undefined;

    const available = createMemo(() => {
        const all = types() ?? [];
        return props.filter ? all.filter(props.filter,) : all;
    },);
    const filtered = createMemo(() => filterEntityTypes(available(), search(),),);
    const selected = createMemo(() => (types() ?? []).find((t,) => t.key === props.value,));

    const reposition = () => {
        if (!controlRef) return;
        const r = controlRef.getBoundingClientRect();
        const w = Math.max(r.width, POPOVER_MIN_WIDTH,);
        setWidth(w,);
        setPos(computeMenuPlacement(
            { top: r.top, bottom: r.bottom, left: r.left, },
            {
                viewportHeight: window.innerHeight,
                viewportWidth: window.innerWidth,
                offset: POPOVER_OFFSET_PX,
                minWidth: w,
                maxHeightVh: POPOVER_MAX_HEIGHT_VH,
                minUsable: POPOVER_MIN_USABLE_PX,
            },
        ),);
    };

    const openPopover = () => {
        if (props.disabled) return;
        reposition();
        setSearch('',);
        const idx = filtered().findIndex((t,) => t.key === props.value);
        setActiveIndex(idx >= 0 ? idx : 0,);
        setOpen(true,);
        queueMicrotask(() => searchRef?.focus(),);
    };

    const closePopover = (refocus = false,) => {
        setOpen(false,);
        setActiveIndex(-1,);
        if (refocus) controlRef?.focus();
    };

    const choose = (key: string,) => {
        if (key !== props.value) props.onChange(key,);
        closePopover(true,);
    };

    const onWindowPointerDown = (e: MouseEvent | TouchEvent,) => {
        if (!open()) return;
        const target = e.target as Node | null;
        if (!target || controlRef?.contains(target,) || popoverRef?.contains(target,)) return;
        closePopover();
    };

    const onWindowKeyDown = (e: KeyboardEvent,) => {
        if (!open()) return;
        const list = filtered();
        if (e.key === 'Escape') {
            e.preventDefault();
            // Inside a modal, Escape must close only this popover.
            e.stopPropagation();
            closePopover(true,);
        } else if (e.key === 'Tab') {
            closePopover();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (list.length) setActiveIndex((i,) => (i + 1) % list.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (list.length) setActiveIndex((i,) => (i <= 0 ? list.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const t = list[activeIndex()];
            if (t) choose(t.key,);
        }
    };

    const onScrollOrResize = () => { if (open()) reposition(); };

    onMount(() => {
        window.addEventListener('mousedown', onWindowPointerDown,);
        window.addEventListener('touchstart', onWindowPointerDown,);
        window.addEventListener('keydown', onWindowKeyDown, true,);
        window.addEventListener('scroll', onScrollOrResize, true,);
        window.addEventListener('resize', onScrollOrResize,);
    },);
    onCleanup(() => {
        window.removeEventListener('mousedown', onWindowPointerDown,);
        window.removeEventListener('touchstart', onWindowPointerDown,);
        window.removeEventListener('keydown', onWindowKeyDown, true,);
        window.removeEventListener('scroll', onScrollOrResize, true,);
        window.removeEventListener('resize', onScrollOrResize,);
    },);

    const onControlKeyDown = (e: KeyboardEvent,) => {
        if (props.disabled || open()) return;
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPopover();
        }
    };

    const originHint = (t: EntityTypeDef,) =>
        t.origin === 'custom' ? 'custom' : t.ownerFeature ? `core · ${t.ownerFeature}` : 'core';

    return (
        <div class={`entity-type-select ${props.disabled ? 'is-disabled' : ''}`}>
            <div
                id={props.id}
                ref={(el,) => { controlRef = el; }}
                class={`entity-type-select__control ${open() ? 'is-open' : ''}`}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open()}
                aria-controls={listboxId}
                aria-label={props.ariaLabel ?? 'Entity type'}
                aria-disabled={props.disabled || undefined}
                tabIndex={props.disabled ? -1 : 0}
                onClick={() => (open() ? closePopover() : openPopover())}
                onKeyDown={onControlKeyDown}
            >
                <Show
                    when={props.value}
                    fallback={<span class="entity-type-select__placeholder">{props.placeholder ?? 'Select a type…'}</span>}
                >
                    <span class="entity-type-select__value">{selected()?.label ?? props.value}</span>
                    <code class="entity-type-select__key">{props.value}</code>
                </Show>
                <span class="entity-type-select__caret" aria-hidden="true">▾</span>
            </div>

            <Show when={open()}>
                <Portal>
                    <div
                        ref={(el,) => { popoverRef = el; }}
                        class="entity-type-select__popover"
                        style={{
                            position: 'fixed',
                            ...(pos().placement === 'above' ? { bottom: `${pos().bottom}px`, } : { top: `${pos().top}px`, }),
                            left: `${pos().left}px`,
                            width: `${width()}px`,
                            'max-height': `${pos().maxHeight}px`,
                        }}
                    >
                        {/* Search-as-you-type: only filters, never committed. */}
                        <input
                            ref={(el,) => { searchRef = el; }}
                            type="text"
                            class="entity-type-select__search"
                            placeholder="Search types…"
                            value={search()}
                            aria-label="Filter entity types"
                            aria-controls={listboxId}
                            aria-activedescendant={activeIndex() >= 0 ? optionId(activeIndex(),) : undefined}
                            autocomplete="off"
                            onInput={(e,) => {
                                setSearch(e.currentTarget.value,);
                                setActiveIndex(0,);
                            }}
                        />
                        <ul id={listboxId} class="entity-type-select__list" role="listbox">
                            <For
                                each={filtered()}
                                fallback={
                                    <li class="entity-type-select__empty" role="presentation">
                                        {types.loading ? 'Loading…' : 'No matching types'}
                                    </li>
                                }
                            >
                                {(t, i,) => (
                                    <li
                                        id={optionId(i(),)}
                                        role="option"
                                        aria-selected={t.key === props.value}
                                        class={`entity-type-select__option${i() === activeIndex() ? ' is-active' : ''}${
                                            t.key === props.value ? ' is-selected' : ''
                                        }`}
                                        onMouseEnter={() => setActiveIndex(i(),)}
                                        onMouseDown={(e,) => e.preventDefault()}
                                        onClick={() => choose(t.key,)}
                                    >
                                        <span class="entity-type-select__option-label">{t.label}</span>
                                        <code class="entity-type-select__option-key">{t.key}</code>
                                        <span class="entity-type-select__option-origin">{originHint(t,)}</span>
                                    </li>
                                )}
                            </For>
                        </ul>
                    </div>
                </Portal>
            </Show>
        </div>
    );
};

export default EntityTypeSelect;
