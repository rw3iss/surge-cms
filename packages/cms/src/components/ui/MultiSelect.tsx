/**
 * MultiSelect — generic, reusable multi-select dropdown.
 *
 * Closed, it shows the selection as removable chips (or `placeholder` when
 * empty). Open, it's a popover list of `ui/Checkbox` rows — never a native
 * `<input type=checkbox>`, per the project rule — plus Select all / Clear.
 *
 * Positioning follows the same recipe as `AddBlockMenu`: render through a
 * `Portal` (so the popover escapes any `overflow:hidden`/`auto` ancestor —
 * a modal body, a flyout panel — the same clipping problem `AnchoredDropdown`
 * solves) and place it with the shared `computeMenuPlacement` helper, which
 * prefers below the control and flips above when there isn't room. The
 * z-index is `$z-index-popover` — the tier reserved for a popover that must
 * win over a modal, since this control is used inside modals too.
 *
 * Keyboard + outside-click are handled on `window` rather than the
 * component's own subtree: a Portal moves the popover out of the DOM
 * hierarchy the wrapper would otherwise listen on, so a listener scoped to
 * the wrapper would never see events from it.
 *
 * Search is search-as-you-type (filters the list on every keystroke) — a
 * deliberate exception to the "commit on blur" text-input rule, since this
 * field exists only to filter, never to produce a committed value of its
 * own.
 *
 *   <MultiSelect
 *     options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Bravo' }]}
 *     value={selected()}
 *     onChange={setSelected}
 *   />
 */
import { Component, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { computeMenuPlacement, type MenuPlacement, } from '../../utils/menuPlacement';
import { Checkbox, } from './Checkbox';
import './MultiSelect.scss';
import {
    allEnabledValues,
    filterOptions,
    type MultiSelectOption,
    nextActiveIndex,
    orderBySelectionOptions,
    toggleSelection,
} from './multiSelectUtils';

export type { MultiSelectOption, };

export interface MultiSelectProps {
    options: MultiSelectOption[];
    value: string[];
    onChange: (next: string[],) => void;
    /** Shown in the closed control when nothing is selected. */
    placeholder?: string;
    /** Forces the search box on/off. Defaults to auto: on once there are
     *  more than 8 options, since that's roughly where scanning a plain
     *  list stops being faster than typing. */
    searchable?: boolean;
    disabled?: boolean;
    id?: string;
    ariaLabel?: string;
    /** How many chips the closed control shows before collapsing the rest
     *  into "+N more". Defaults to 3. */
    maxChipsShown?: number;
    /** Extra class on the outer wrapper for ad-hoc layout tweaks. */
    class?: string;
}

const POPOVER_OFFSET_PX = 4;
const POPOVER_MIN_WIDTH = 220;
const POPOVER_MAX_HEIGHT_VH = 60;
/** Below this much room underneath the control, the popover flips above it. */
const POPOVER_MIN_USABLE_PX = 160;
/** Auto-enable search once there are more options than this. */
const SEARCH_AUTO_THRESHOLD = 8;

export const MultiSelect: Component<MultiSelectProps> = (props,) => {
    const listboxId = `multiselect-listbox-${createUniqueId()}`;
    const optionId = (i: number,) => `${listboxId}-opt-${i}`;

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

    const isSearchable = () => props.searchable ?? (props.options.length > SEARCH_AUTO_THRESHOLD);
    const maxChips = () => props.maxChipsShown ?? 3;

    /** Selected values, always in OPTIONS order — never click order. */
    const orderedSelected = createMemo(() => orderBySelectionOptions(props.value, props.options,),);
    const selectedOptions = createMemo(() => {
        const byValue = new Map(props.options.map((o,) => [o.value, o,],),);
        // A value with no matching option (stale data) still renders as a
        // removable chip, labelled with its raw value, rather than vanishing.
        return orderedSelected().map((v,) => byValue.get(v,) ?? { value: v, label: v, },);
    },);

    const filteredOptions = createMemo(() => filterOptions(props.options, isSearchable() ? search() : '',),);

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
        setActiveIndex(nextActiveIndex(props.options, -1, 1,),);
        setOpen(true,);
        if (isSearchable()) {
            // Wait for the Portal content to mount before focusing it.
            queueMicrotask(() => searchRef?.focus(),);
        }
    };

    const closePopover = (refocusControl = false,) => {
        setOpen(false,);
        setActiveIndex(-1,);
        if (refocusControl) controlRef?.focus();
    };

    const toggleOpen = () => {
        if (props.disabled) return;
        if (open()) closePopover();
        else openPopover();
    };

    const commitToggle = (value: string,) => {
        if (props.disabled) return;
        const opt = props.options.find((o,) => o.value === value,);
        if (opt?.disabled) return;
        props.onChange(toggleSelection(props.value, props.options, value,),);
    };

    const selectAllVisible = () => {
        if (props.disabled) return;
        const toAdd = allEnabledValues(filteredOptions(),);
        const merged = Array.from(new Set([...props.value, ...toAdd,],),);
        props.onChange(orderBySelectionOptions(merged, props.options,),);
    };

    const clearAll = () => {
        if (props.disabled) return;
        props.onChange([],);
    };

    // ─── window-level listeners (open only) ───────────────────────────
    // Click-outside and keyboard both have to live on `window`, not the
    // wrapper: the popover is Portal-rendered elsewhere in the DOM, so a
    // listener on the wrapper would never see events bubbling from it.

    const onWindowPointerDown = (e: MouseEvent | TouchEvent,) => {
        if (!open()) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (controlRef?.contains(target,)) return;
        if (popoverRef?.contains(target,)) return;
        closePopover();
    };

    const onWindowKeyDown = (e: KeyboardEvent,) => {
        if (!open()) return;
        const inSearch = isSearchable() && e.target === searchRef;

        if (e.key === 'Escape') {
            e.preventDefault();
            closePopover(true,);
            return;
        }
        if (e.key === 'Tab') {
            // Let focus move wherever it was headed; just close the popover.
            closePopover();
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i,) => nextActiveIndex(filteredOptions(), i, 1,),);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i,) => nextActiveIndex(filteredOptions(), i, -1,),);
            return;
        }
        if (e.key === 'Enter' || (e.key === ' ' && !inSearch)) {
            e.preventDefault();
            const opt = filteredOptions()[activeIndex()];
            if (opt) commitToggle(opt.value,);
            return;
        }
        if (e.key === 'Backspace') {
            // Only when there's nothing left to delete from the search box —
            // a non-empty search still edits normally.
            const searchIsEmpty = !isSearchable() || search() === '';
            if (!searchIsEmpty) return;
            const last = orderedSelected()[orderedSelected().length - 1];
            if (last !== undefined) {
                e.preventDefault();
                commitToggle(last,);
            }
        }
    };

    const onScrollOrResize = () => { if (open()) reposition(); };

    onMount(() => {
        window.addEventListener('mousedown', onWindowPointerDown,);
        window.addEventListener('touchstart', onWindowPointerDown,);
        window.addEventListener('keydown', onWindowKeyDown,);
        window.addEventListener('scroll', onScrollOrResize, true,);
        window.addEventListener('resize', onScrollOrResize,);
    },);
    onCleanup(() => {
        window.removeEventListener('mousedown', onWindowPointerDown,);
        window.removeEventListener('touchstart', onWindowPointerDown,);
        window.removeEventListener('keydown', onWindowKeyDown,);
        window.removeEventListener('scroll', onScrollOrResize, true,);
        window.removeEventListener('resize', onScrollOrResize,);
    },);

    /** Opens the popover from the CLOSED control via keyboard — once open,
     *  `onWindowKeyDown` takes over. */
    const onControlKeyDown = (e: KeyboardEvent,) => {
        if (props.disabled || open()) return;
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPopover();
        }
    };

    const activeId = () => (activeIndex() >= 0 ? optionId(activeIndex(),) : undefined);

    return (
        <div class={`ui-multiselect ${props.disabled ? 'is-disabled' : ''} ${props.class ?? ''}`}>
            <div
                id={props.id}
                ref={(el,) => { controlRef = el; }}
                class={`ui-multiselect__control ${open() ? 'is-open' : ''}`}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open()}
                aria-controls={listboxId}
                aria-activedescendant={open() ? activeId() : undefined}
                aria-label={props.ariaLabel}
                aria-disabled={props.disabled || undefined}
                tabIndex={props.disabled ? -1 : 0}
                onClick={toggleOpen}
                onKeyDown={onControlKeyDown}
            >
                <Show
                    when={selectedOptions().length > 0}
                    fallback={<span class="ui-multiselect__placeholder">{props.placeholder ?? 'None selected'}</span>}
                >
                    <span class="ui-multiselect__chips">
                        <For each={selectedOptions().slice(0, maxChips(),)}>
                            {(opt,) => (
                                <span class="ui-multiselect__chip">
                                    <span class="ui-multiselect__chip-label">{opt.label}</span>
                                    <button
                                        type="button"
                                        class="ui-multiselect__chip-remove"
                                        aria-label={`Remove ${opt.label}`}
                                        disabled={props.disabled}
                                        // Removing a chip must not also open the popover —
                                        // stop it reaching the control's onClick.
                                        onMouseDown={(e,) => e.stopPropagation()}
                                        onClick={(e,) => { e.stopPropagation(); commitToggle(opt.value,); }}
                                    >
                                        &times;
                                    </button>
                                </span>
                            )}
                        </For>
                        <Show when={selectedOptions().length > maxChips()}>
                            <span class="ui-multiselect__chip-more">
                                +{selectedOptions().length - maxChips()} more
                            </span>
                        </Show>
                    </span>
                </Show>
            </div>

            <Show when={open()}>
                <Portal>
                    <div
                        ref={(el,) => { popoverRef = el; }}
                        class="ui-multiselect__popover"
                        style={{
                            position: 'fixed',
                            ...(pos().placement === 'above' ? { bottom: `${pos().bottom}px`, } : { top: `${pos().top}px`, }),
                            left: `${pos().left}px`,
                            width: `${width()}px`,
                            'max-height': `${pos().maxHeight}px`,
                        }}
                    >
                        <Show when={isSearchable()}>
                            {/* Search-as-you-type: filters the list on every
                                keystroke, by design — this field only filters,
                                it never produces a committed value, so the
                                usual "commit on blur" rule doesn't apply. */}
                            <input
                                ref={(el,) => { searchRef = el; }}
                                type="text"
                                class="ui-multiselect__search"
                                placeholder="Search…"
                                value={search()}
                                aria-label="Filter options"
                                aria-activedescendant={activeId()}
                                autocomplete="off"
                                onInput={(e,) => {
                                    const q = e.currentTarget.value;
                                    setSearch(q,);
                                    setActiveIndex(nextActiveIndex(filterOptions(props.options, q,), -1, 1,),);
                                }}
                            />
                        </Show>

                        <div class="ui-multiselect__actions">
                            <button type="button" class="ui-multiselect__action" onClick={selectAllVisible}>
                                Select all
                            </button>
                            <button type="button" class="ui-multiselect__action" onClick={clearAll}>
                                Clear
                            </button>
                        </div>

                        <ul id={listboxId} class="ui-multiselect__list" role="listbox" aria-multiselectable="true">
                            <For
                                each={filteredOptions()}
                                fallback={<li class="ui-multiselect__empty" role="presentation">No matches</li>}
                            >
                                {(opt, i,) => {
                                    const checked = () => props.value.includes(opt.value,);
                                    return (
                                        <li
                                            id={optionId(i(),)}
                                            class={`ui-multiselect__option ${i() === activeIndex() ? 'is-active' : ''}`}
                                            role="option"
                                            aria-selected={checked()}
                                            aria-disabled={opt.disabled || undefined}
                                            onMouseEnter={() => setActiveIndex(i(),)}
                                        >
                                            <Checkbox
                                                checked={checked()}
                                                disabled={opt.disabled}
                                                onChange={() => commitToggle(opt.value,)}
                                                label={
                                                    <span class="ui-multiselect__option-text">
                                                        <span class="ui-multiselect__option-label">{opt.label}</span>
                                                        <Show when={opt.hint}>
                                                            <span class="ui-multiselect__option-hint">{opt.hint}</span>
                                                        </Show>
                                                    </span>
                                                }
                                            />
                                        </li>
                                    );
                                }}
                            </For>
                        </ul>
                    </div>
                </Portal>
            </Show>
        </div>
    );
};

export default MultiSelect;
