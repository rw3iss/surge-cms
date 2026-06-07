import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';

export interface EntitySearchItem {
    id: string;
    title: string;
    slug: string;
    status?: string;
    [key: string]: unknown;
}

export interface EntitySearchSelectProps {
    /** The label shown above the input */
    label?: string;
    /** Placeholder text when no item is selected */
    placeholder?: string;
    /** The currently selected item's title (for display) */
    selectedTitle?: string;
    /** The currently selected item's id */
    selectedId?: string;
    /** Async function to fetch the list of items (cached internally by caller) */
    fetchItems: () => Promise<EntitySearchItem[]>;
    /** Called when an item is selected */
    onSelect: (item: EntitySearchItem,) => void;
    /** Optional message when no items match the search */
    emptyMessage?: string;
}

const EntitySearchSelect: Component<EntitySearchSelectProps> = (props,) => {
    const [search, setSearch,] = createSignal(props.selectedTitle || '',);
    const [showDropdown, setShowDropdown,] = createSignal(false,);
    const [dropdownPos, setDropdownPos,] = createSignal({ top: 0, left: 0, width: 0, },);
    let containerRef: HTMLDivElement | undefined;
    let inputRef: HTMLInputElement | undefined;

    // Use onMount instead of createResource to avoid triggering Suspense
    const [items, setItems,] = createSignal<EntitySearchItem[]>([],);
    onMount(async () => {
        try {
            const result = await props.fetchItems();
            setItems(result,);
        } catch { /* ignore */ }
    },);

    const filtered = () => {
        const list = items();
        const q = search().toLowerCase().trim();
        if (!q) return list;
        return list.filter(
            (item,) =>
                item.title?.toLowerCase().includes(q,) ||
                item.slug?.toLowerCase().includes(q,),
        );
    };

    const handleSelect = (item: EntitySearchItem,) => {
        props.onSelect(item,);
        setSearch(item.title,);
        setShowDropdown(false,);
    };

    const handleClickOutside = (e: MouseEvent,) => {
        if (containerRef && !containerRef.contains(e.target as Node,)) {
            setShowDropdown(false,);
        }
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('mousedown', handleClickOutside,);
        onCleanup(() => document.removeEventListener('mousedown', handleClickOutside,),);
    }

    const updateDropdownPos = () => {
        if (inputRef) {
            const rect = inputRef.getBoundingClientRect();
            setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width, },);
        }
    };

    return (
        <div class="entity-search" ref={containerRef} style={{ position: 'relative', }}>
            <Show when={props.label}>
                <label>{props.label}</label>
            </Show>
            <input
                ref={inputRef}
                type="text"
                value={search()}
                onInput={(e,) => {
                    setSearch(e.currentTarget.value,);
                    updateDropdownPos();
                    setShowDropdown(true,);
                }}
                onFocus={() => { updateDropdownPos(); setShowDropdown(true,); }}
                placeholder={props.placeholder || 'Search...'}
                autocomplete="off"
            />
            <Show when={showDropdown()}>
                {/* Render via Portal so the dropdown escapes any containing-
                    block created by an ancestor's transform / will-change /
                    contain. Without this the popover gets clipped inside
                    flyout panels and modals even though it's position: fixed. */}
                <Portal>
                <div
                    class="entity-search__dropdown"
                    style={{
                        position: 'fixed',
                        top: `${dropdownPos().top}px`,
                        left: `${dropdownPos().left}px`,
                        width: `${dropdownPos().width}px`,
                    }}
                >
                    <Show when={filtered().length > 0}>
                        <For each={filtered()}>
                            {(item,) => (
                                <button
                                    type="button"
                                    class={`entity-search__option ${
                                        props.selectedId === item.id ? 'entity-search__option--selected' : ''
                                    }`}
                                    onClick={() => handleSelect(item,)}
                                >
                                    <span class="entity-search__option-title">{item.title}</span>
                                    <span class="entity-search__option-meta">
                                        /{item.slug}
                                        <Show when={item.status}>
                                            {' '}&middot; {item.status as string}
                                        </Show>
                                    </span>
                                </button>
                            )}
                        </For>
                    </Show>
                    <Show when={filtered().length === 0}>
                        <div class="entity-search__empty">
                            {props.emptyMessage || 'No items found'}
                        </div>
                    </Show>
                </div>
                </Portal>
            </Show>
        </div>
    );
};

export default EntitySearchSelect;
