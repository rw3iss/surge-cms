import { Component, createResource, createSignal, For, onCleanup, Show, } from 'solid-js';

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
    let containerRef: HTMLDivElement | undefined;

    const [items,] = createResource(async () => props.fetchItems(),);

    const filtered = () => {
        const list = items() || [];
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

    return (
        <div class="entity-search" ref={containerRef} style={{ position: 'relative', }}>
            <Show when={props.label}>
                <label>{props.label}</label>
            </Show>
            <input
                type="text"
                value={search()}
                onInput={(e,) => {
                    setSearch(e.currentTarget.value,);
                    setShowDropdown(true,);
                }}
                onFocus={() => setShowDropdown(true,)}
                placeholder={props.placeholder || 'Search...'}
                autocomplete="off"
            />
            <Show when={showDropdown()}>
                <div class="entity-search__dropdown">
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
            </Show>
        </div>
    );
};

export default EntitySearchSelect;
