import { Component, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import {
    BLOCK_TYPES,
    type BlockType,
    type BlockTypeConfig,
    MENU_CATEGORIES,
    type RecentSource,
} from '../../../config/blockTypes';
import { fetchRecent, getRecent, type RecentItem, } from '../../../services/recentItems';
import { isFeatureEnabled, } from '../../../stores/siteSettings';

/**
 * Categorized "+ Add Block" picker. Renders a portal-mounted panel
 * organized into collapsible sections (Text / Media / Blocks / Layout)
 * and gated on site features. Items with a `recentSource` (Campaign,
 * Form, Posts) expose a hover submenu listing the most recent matching
 * items so the operator can pre-fill the new block's id field in one
 * click.
 *
 * Reused everywhere a "+ Add Block" affordance appears (top of editor,
 * bottom of editor, empty group_item slot picker).
 */

interface AddBlockMenuProps {
    /** Visual variant for the trigger button. */
    triggerSize?: 'normal' | 'small';
    /** Called when the user picks a block type. `initialData` is set
     *  when the user picked from a "recent items" submenu — the
     *  consumer should merge it into the new block's `data`. */
    onSelect: (type: BlockType, initialData?: Record<string, unknown>,) => void;
    /** Optional override for the type list — defaults to the global
     *  registry. Filtered by feature gates either way. */
    types?: Array<{ type: BlockType; label: string; }>;
}

const MENU_OFFSET_PX = 6;
const MENU_MIN_WIDTH = 240;
const MENU_MAX_HEIGHT_VH = 70;
const SUBMENU_OFFSET_PX = 4;
const SUBMENU_WIDTH = 240;
const HOVER_CLOSE_DELAY_MS = 120;

export const AddBlockMenu: Component<AddBlockMenuProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    const [pos, setPos,] = createSignal({ top: 0, left: 0, maxHeight: 400, },);
    // Sections start collapsed — keeps the menu compact and lets the
    // operator open the one they want without scrolling past everything.
    const [collapsed, setCollapsed,] = createSignal<Record<string, boolean>>(
        Object.fromEntries(MENU_CATEGORIES.map((c,) => [c.key, true,]),),
    );
    const [hoveredType, setHoveredType,] = createSignal<BlockType | null>(null,);
    const [submenuPos, setSubmenuPos,] = createSignal({ top: 0, left: 0, },);

    let triggerRef: HTMLButtonElement | undefined;
    let menuRef: HTMLDivElement | undefined;
    let submenuRef: HTMLDivElement | undefined;
    let closeSubmenuTimer: ReturnType<typeof setTimeout> | undefined;

    /** When `props.types` is set, only show those types but still apply
     *  the categorization + gating. Otherwise use the full registry. */
    const visibleTypes = createMemo<BlockTypeConfig[]>(() => {
        const allowSet = props.types ? new Set(props.types.map(t => t.type),) : null;
        return BLOCK_TYPES.filter((t,) => {
            if (t.enabled === false) return false;
            if (allowSet && !allowSet.has(t.type,)) return false;
            if (t.gating && !isFeatureEnabled(t.gating,)) return false;
            return true;
        },);
    },);

    const visibleByCategory = createMemo(() => {
        const map = new Map<string, BlockTypeConfig[]>();
        for (const t of visibleTypes()) {
            const key = t.category ?? 'other';
            (map.get(key,) ?? map.set(key, [],).get(key,)!).push(t,);
        }
        return map;
    },);

    /** Compute panel position relative to the trigger using fixed coords. */
    const reposition = () => {
        if (!triggerRef) return;
        const r = triggerRef.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;

        const desiredMaxHeight = Math.floor(vh * (MENU_MAX_HEIGHT_VH / 100),);
        let top = r.bottom + MENU_OFFSET_PX;
        let left = r.left;

        if (left + MENU_MIN_WIDTH > vw - 12) {
            left = Math.max(12, vw - MENU_MIN_WIDTH - 12,);
        }
        const spaceBelow = vh - r.bottom - MENU_OFFSET_PX;
        const spaceAbove = r.top - MENU_OFFSET_PX;
        let maxHeight = desiredMaxHeight;
        if (spaceBelow < 240 && spaceAbove > spaceBelow) {
            maxHeight = Math.min(desiredMaxHeight, Math.max(160, spaceAbove - 12,),);
            top = r.top - MENU_OFFSET_PX - maxHeight;
        } else {
            maxHeight = Math.min(desiredMaxHeight, Math.max(160, spaceBelow - 12,),);
        }
        setPos({ top, left, maxHeight, },);
    };

    const onWindowEvent = (e: MouseEvent | TouchEvent,) => {
        if (!open()) return;
        const target = e.target as Node | null;
        if (!target) return;
        if (triggerRef?.contains(target,)) return;
        if (menuRef?.contains(target,)) return;
        if (submenuRef?.contains(target,)) return;
        setOpen(false,);
        setHoveredType(null,);
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape' && open()) {
            setOpen(false,);
            setHoveredType(null,);
            triggerRef?.focus();
        }
    };

    const onScrollOrResize = () => {
        if (open()) reposition();
    };

    onMount(() => {
        window.addEventListener('mousedown', onWindowEvent,);
        window.addEventListener('touchstart', onWindowEvent,);
        window.addEventListener('keydown', onKeyDown,);
        window.addEventListener('scroll', onScrollOrResize, true,);
        window.addEventListener('resize', onScrollOrResize,);
    },);

    onCleanup(() => {
        window.removeEventListener('mousedown', onWindowEvent,);
        window.removeEventListener('touchstart', onWindowEvent,);
        window.removeEventListener('keydown', onKeyDown,);
        window.removeEventListener('scroll', onScrollOrResize, true,);
        window.removeEventListener('resize', onScrollOrResize,);
        if (closeSubmenuTimer) clearTimeout(closeSubmenuTimer,);
    },);

    const toggle = () => {
        const next = !open();
        if (next) reposition();
        setOpen(next,);
    };

    const handleSelect = (type: BlockType, initialData?: Record<string, unknown>,) => {
        setOpen(false,);
        setHoveredType(null,);
        props.onSelect(type, initialData,);
    };

    const toggleCategory = (key: string,) => {
        setCollapsed(prev => ({ ...prev, [key]: !prev[key], }),);
    };

    /** Show the recent-items submenu for an item with `recentSource`.
     *  Position is clamped to the viewport on both axes so narrow
     *  windows (e.g. inline flyouts) still show the whole submenu. */
    const openSubmenu = (type: BlockType, source: RecentSource, rowEl: HTMLElement,) => {
        if (closeSubmenuTimer) {
            clearTimeout(closeSubmenuTimer,);
            closeSubmenuTimer = undefined;
        }
        setHoveredType(type,);
        const r = rowEl.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left = r.right + SUBMENU_OFFSET_PX;
        if (left + SUBMENU_WIDTH > vw - 12) {
            left = Math.max(12, r.left - SUBMENU_WIDTH - SUBMENU_OFFSET_PX,);
        }
        // Vertical clamp: if the row is near the bottom, anchor the
        // submenu so its bottom sits 12px above the viewport floor.
        const SUBMENU_MIN_HEIGHT = 160;
        let top = r.top;
        if (top + SUBMENU_MIN_HEIGHT > vh - 12) {
            top = Math.max(12, vh - SUBMENU_MIN_HEIGHT - 12,);
        }
        setSubmenuPos({ top, left, },);
        // Fetch lazily; re-uses cache.
        if (!getRecent(source,)) void fetchRecent(source,);
    };

    const scheduleCloseSubmenu = () => {
        closeSubmenuTimer = setTimeout(() => {
            setHoveredType(null,);
            closeSubmenuTimer = undefined;
        }, HOVER_CLOSE_DELAY_MS,);
    };

    const cancelCloseSubmenu = () => {
        if (closeSubmenuTimer) {
            clearTimeout(closeSubmenuTimer,);
            closeSubmenuTimer = undefined;
        }
    };

    const triggerClass = () =>
        props.triggerSize === 'small'
            ? 'btn btn--secondary btn--small'
            : 'btn btn--secondary';

    return (
        <span class="add-block-menu">
            <button
                ref={(el,) => { triggerRef = el; }}
                type="button"
                class={triggerClass()}
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={open()}
            >
                + Add Block
            </button>
            <Show when={open()}>
                <Portal>
                    <div
                        ref={(el,) => { menuRef = el; }}
                        class="add-block-menu__panel"
                        role="menu"
                        style={{
                            top: `${pos().top}px`,
                            left: `${pos().left}px`,
                            'max-height': `${pos().maxHeight}px`,
                            'min-width': `${MENU_MIN_WIDTH}px`,
                        }}
                    >
                        <For each={MENU_CATEGORIES}>
                            {(cat,) => {
                                const items = () => visibleByCategory().get(cat.key,) ?? [];
                                return (
                                    <Show when={items().length > 0}>
                                        <div class="add-block-menu__section">
                                            <button
                                                type="button"
                                                class={`add-block-menu__section-header ${
                                                    collapsed()[cat.key] ? 'is-collapsed' : ''
                                                }`}
                                                onClick={() => toggleCategory(cat.key,)}
                                                aria-expanded={!collapsed()[cat.key]}
                                            >
                                                <span class="add-block-menu__chev">
                                                    {collapsed()[cat.key] ? '▸' : '▾'}
                                                </span>
                                                <span>{cat.label}</span>
                                            </button>
                                            <Show when={!collapsed()[cat.key]}>
                                                <ul class="add-block-menu__items" role="menu">
                                                    <For each={items()}>
                                                        {(bt,) => (
                                                            <ItemRow
                                                                config={bt}
                                                                onSelect={handleSelect}
                                                                onHoverSubmenu={openSubmenu}
                                                                onLeaveSubmenu={scheduleCloseSubmenu}
                                                                onCancelClose={cancelCloseSubmenu}
                                                                hoveredType={hoveredType()}
                                                            />
                                                        )}
                                                    </For>
                                                </ul>
                                            </Show>
                                        </div>
                                    </Show>
                                );
                            }}
                        </For>
                    </div>

                    {/* Recent-items submenu */}
                    <Show when={hoveredType()}>
                        {(type,) => {
                            const cfg = visibleTypes().find(t => t.type === type(),);
                            if (!cfg?.recentSource || !cfg.recentDataField) return null;
                            const items = () => getRecent(cfg.recentSource!,) || [];
                            return (
                                <div
                                    ref={(el,) => { submenuRef = el; }}
                                    class="add-block-menu__submenu"
                                    style={{
                                        top: `${submenuPos().top}px`,
                                        left: `${submenuPos().left}px`,
                                        width: `${SUBMENU_WIDTH}px`,
                                    }}
                                    onMouseEnter={cancelCloseSubmenu}
                                    onMouseLeave={scheduleCloseSubmenu}
                                >
                                    <div class="add-block-menu__submenu-header">
                                        Recent {cfg.label}
                                    </div>
                                    <Show
                                        when={items().length > 0}
                                        fallback={
                                            <div class="add-block-menu__submenu-empty">
                                                {getRecent(cfg.recentSource!,) === null
                                                    ? 'Loading…'
                                                    : 'No recent items'}
                                            </div>
                                        }
                                    >
                                        <For each={items()}>
                                            {(item: RecentItem,) => (
                                                <button
                                                    type="button"
                                                    class="add-block-menu__submenu-item"
                                                    onClick={() => {
                                                        const dataField = cfg.recentDataField!;
                                                        // For array-typed fields like
                                                        // pinnedPostIds, wrap the id in [id].
                                                        const value: unknown = dataField.endsWith('Ids',)
                                                            ? [item.id,]
                                                            : item.id;
                                                        handleSelect(cfg.type, { [dataField]: value, },);
                                                    }}
                                                >
                                                    <span class="add-block-menu__submenu-title">
                                                        {item.title}
                                                    </span>
                                                </button>
                                            )}
                                        </For>
                                    </Show>
                                </div>
                            );
                        }}
                    </Show>
                </Portal>
            </Show>
        </span>
    );
};

// ─── Item row ──────────────────────────────────────────────────────

interface ItemRowProps {
    config: BlockTypeConfig;
    onSelect: (type: BlockType, initialData?: Record<string, unknown>,) => void;
    onHoverSubmenu: (type: BlockType, source: RecentSource, rowEl: HTMLElement,) => void;
    onLeaveSubmenu: () => void;
    onCancelClose: () => void;
    hoveredType: BlockType | null;
}

const ItemRow: Component<ItemRowProps> = (props,) => {
    let rowRef: HTMLLIElement | undefined;
    const hasSubmenu = () => Boolean(props.config.recentSource,);
    const isOpen = () => hasSubmenu() && props.hoveredType === props.config.type;

    return (
        <li
            ref={(el,) => { rowRef = el; }}
            class={`add-block-menu__item-row ${isOpen() ? 'is-active' : ''}`}
            onMouseEnter={() => {
                props.onCancelClose();
                if (hasSubmenu() && rowRef) {
                    props.onHoverSubmenu(props.config.type, props.config.recentSource!, rowRef,);
                }
            }}
            onMouseLeave={() => {
                if (hasSubmenu()) props.onLeaveSubmenu();
            }}
        >
            <button
                type="button"
                role="menuitem"
                class="add-block-menu__item"
                onClick={() => props.onSelect(props.config.type,)}
            >
                <Show when={props.config.icon}>
                    <span class="add-block-menu__item-icon">{props.config.icon}</span>
                </Show>
                <span class="add-block-menu__item-label">{props.config.label}</span>
                <Show when={hasSubmenu()}>
                    <span class="add-block-menu__item-chev">›</span>
                </Show>
            </button>
        </li>
    );
};

export default AddBlockMenu;
