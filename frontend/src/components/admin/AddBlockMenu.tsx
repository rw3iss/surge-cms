import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import type { BlockType, } from '../../config/blockTypes';
import { getEnabledBlockTypeOptions, } from '../../config/blockTypes';

/**
 * "+ Add Block" trigger + portal-rendered menu.
 *
 * The menu is rendered via <Portal> into document.body and positioned
 * with `position: fixed`, computed from the trigger's bounding rect.
 * This is the only reliable way to escape ancestor clipping (the
 * editor's `overflow: hidden`/`overflow-x: hidden` chains were chopping
 * the previous in-flow dropdown to ~3 visible items).
 *
 * Open behavior:
 *   - flies out to the right of and below the trigger by default
 *   - if there's no room on the right (button near right edge),
 *     falls back to the left of the trigger
 *   - if there's no room below, anchors above
 *
 * Close behavior:
 *   - click on the trigger toggles it
 *   - click anywhere else closes it
 *   - Escape closes it
 *   - selecting an item closes it (and dispatches onSelect)
 */

interface AddBlockMenuProps {
    /** Visual variant for the trigger button. Matches existing classnames. */
    triggerSize?: 'normal' | 'small';
    onSelect: (type: BlockType,) => void;
    /**
     * Optional override for the type list. Defaults to all
     * registered+enabled block types in the central registry.
     */
    types?: Array<{ type: BlockType; label: string; }>;
}

const MENU_OFFSET_PX = 6; // gap between trigger and menu
const MENU_MIN_WIDTH = 200;
const MENU_MAX_HEIGHT_VH = 60; // % of viewport height

export const AddBlockMenu: Component<AddBlockMenuProps> = (props,) => {
    const [open, setOpen,] = createSignal(false,);
    const [pos, setPos,] = createSignal<{ top: number; left: number; maxHeight: number; }>({
        top: 0,
        left: 0,
        maxHeight: 400,
    },);

    let triggerRef: HTMLButtonElement | undefined;
    let menuRef: HTMLDivElement | undefined;

    /** Compute menu position relative to the trigger using fixed coords. */
    const reposition = () => {
        if (!triggerRef) return;
        const r = triggerRef.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;

        const desiredMaxHeight = Math.floor(vh * (MENU_MAX_HEIGHT_VH / 100),);
        // Default: anchor below + to the right of trigger.
        let top = r.bottom + MENU_OFFSET_PX;
        let left = r.left;

        // If we'd overflow the viewport on the right, anchor right edge to viewport.
        if (left + MENU_MIN_WIDTH > vw - 12) {
            left = Math.max(12, vw - MENU_MIN_WIDTH - 12,);
        }
        // If we'd overflow the viewport on the bottom, flip above.
        const spaceBelow = vh - r.bottom - MENU_OFFSET_PX;
        const spaceAbove = r.top - MENU_OFFSET_PX;
        let maxHeight = desiredMaxHeight;
        if (spaceBelow < 200 && spaceAbove > spaceBelow) {
            // Flip above the trigger.
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
        // Ignore clicks inside the trigger or menu.
        if (triggerRef?.contains(target,)) return;
        if (menuRef?.contains(target,)) return;
        setOpen(false,);
    };

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape' && open()) {
            setOpen(false,);
            triggerRef?.focus();
        }
    };

    const onScrollOrResize = () => {
        if (open()) reposition();
    };

    onMount(() => {
        // Use mousedown rather than click so the menu closes BEFORE any
        // bubbling click handler on a clicked link or button could fire
        // through.
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
    },);

    const toggle = () => {
        const next = !open();
        if (next) reposition();
        setOpen(next,);
    };

    const handleSelect = (type: BlockType,) => {
        setOpen(false,);
        props.onSelect(type,);
    };

    const triggerClass = () =>
        props.triggerSize === 'small'
            ? 'btn btn--secondary btn--small'
            : 'btn btn--secondary';

    const types = () => props.types ?? getEnabledBlockTypeOptions();

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
                        }}
                    >
                        <For each={types()}>
                            {(bt,) => (
                                <button
                                    type="button"
                                    role="menuitem"
                                    class="add-block-menu__item"
                                    onClick={() => handleSelect(bt.type,)}
                                >
                                    {bt.label}
                                </button>
                            )}
                        </For>
                    </div>
                </Portal>
            </Show>
        </span>
    );
};

export default AddBlockMenu;
