import { Component, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { createBlockDefaultData, getEnabledBlockTypeOptions, } from '../../../config/blockTypes';
import { DEFAULT_MOBILE_DEVICE, MOBILE_DEVICES, } from '../../../config/mobileDevices';
import { BlockStyleService, } from '../../../services/blockStyles';
import AddBlockMenu from './AddBlockMenu';
import BlockEditController from './BlockEditController';
import ContentBlock, { BlockData, BlockType, } from './ContentBlock';
import FlyoutPanel, { type FlyoutMode, } from '../common/FlyoutPanel';
import Toggle from '../common/Toggle';
import { generateBlockId, } from '../../../utils/blockId';
import { titleizeBlockType, } from '../../../config/blockTypes';

export type { BlockData, BlockType, } from './ContentBlock';

export interface BlockTypeOption {
    type: BlockType;
    label: string;
}

interface BlockEditorProps {
    blocks: BlockData[];
    onBlocksChange: (blocks: BlockData[],) => void;
    blockTypes?: BlockTypeOption[];
    title?: string;
    /** Inline styles applied to the blocks container (for site appearance preview) */
    containerStyle?: Record<string, string>;
    /** Extra CSS class on the blocks container */
    containerClass?: string;
    /** Snapshot of blocks as last saved — used for dirty detection & revert */
    savedBlocks?: BlockData[];
    /** Fired when the full-width preview toggle changes. The host editor
     *  uses this to add `.admin-full-bleed` to its page root so the whole
     *  editor (content column + edit panel) uses the full page width, not
     *  just the block preview frame. */
    onFullWidthChange?: (full: boolean,) => void;
}

/**
 * Block types come from the central registry in `config/blockTypes.ts`.
 * Editors can still pass a custom `blockTypes` prop to restrict the
 * list (e.g. an embed-only context), but by default we surface every
 * registered+enabled type.
 */

// Real UUIDs from the start (see utils/blockId) so newly-added group children
// can reference their parent before either has been saved to the server.

// ─── Block-tree helpers ───
//
// Operations (add, remove, move) are easier to express on a tree than on
// a flat array — so we build a tree, mutate, and flatten back. The flat
// representation is what the editor stores and what `onBlocksChange`
// emits; we keep an invariant that parents come before their descendants
// in the flat array (DFS order).

type BlockNode = BlockData & { children: BlockNode[]; };

function treeify(flat: BlockData[],): BlockNode[] {
    const nodes = new Map<string, BlockNode>();
    for (const b of flat) nodes.set(b.id, { ...b, children: [], },);
    const roots: BlockNode[] = [];
    for (const b of flat) {
        const node = nodes.get(b.id,)!;
        const parent = b.parentBlockId ? nodes.get(b.parentBlockId,) : null;
        if (parent) parent.children.push(node,);
        else roots.push(node,);
    }
    return roots;
}

function flattenTree(tree: BlockNode[],): BlockData[] {
    const out: BlockData[] = [];
    const walk = (list: BlockNode[],) => {
        for (let i = 0; i < list.length; i++) {
            const { children, ...rest } = list[i];
            out.push({ ...rest, sort_order: i, },);
            walk(children,);
        }
    };
    walk(tree,);
    return out;
}

/** Locate a node + its containing list. Returns null if not found. */
function findInTree(
    tree: BlockNode[],
    id: string,
): { parent: BlockNode[]; idx: number; node: BlockNode; } | null {
    for (let i = 0; i < tree.length; i++) {
        if (tree[i].id === id) return { parent: tree, idx: i, node: tree[i], };
        const sub = findInTree(tree[i].children, id,);
        if (sub) return sub;
    }
    return null;
}

const newGroupItem = (parentId: string,): BlockData => ({
    id: generateBlockId(),
    type: 'group_item',
    parentBlockId: parentId,
    sort_order: 0,
    data: {},
});

/** Deep-compare two block snapshots (data + styleRef). */
const blockEquals = (a: BlockData | undefined, b: BlockData | undefined,): boolean => {
    if (!a || !b) return a === b;
    if (a.type !== b.type) return false;
    return JSON.stringify({ d: a.data, s: a.styleRef, },) ===
        JSON.stringify({ d: b.data, s: b.styleRef, },);
};

const BlockEditor: Component<BlockEditorProps> = (props,) => {
    const [selectedBlockId, setSelectedBlockId,] = createSignal<string | null>(null,);
    const [flyoutSide, setFlyoutSide,] = createSignal<'left' | 'right'>('right',);
    const [flyoutMode, setFlyoutMode,] = createSignal<FlyoutMode>('inline',);

    // ─── Internal block store ───
    //
    // Mirror `props.blocks` into a Solid store keyed by `id`. `reconcile`
    // mutates store proxies in place when their fields change rather than
    // replacing the array's items, so iterating with `<For>` keeps the
    // same component instance for an unchanged-id block — even when the
    // parent emits a brand-new array on every keystroke. That stability
    // is what lets the inline HTML / Rich Text editors keep CodeMirror
    // (and caret focus) alive while the user types.
    const [storeBlocks, setStoreBlocks,] = createStore<BlockData[]>([],);
    createEffect(() => {
        setStoreBlocks(reconcile(props.blocks, { key: 'id', merge: true, },),);
    },);

    // ─── Saved-state snapshots for dirty detection ───
    // savedSnapshots stores the last-saved version of each block keyed by id.
    const [savedSnapshots, setSavedSnapshots,] = createSignal<Map<string, BlockData>>(new Map(),);

    // Rebuild snapshots when savedBlocks prop changes (i.e. after a save).
    createEffect(on(
        () => props.savedBlocks,
        (saved,) => {
            if (!saved) return;
            const map = new Map<string, BlockData>();
            for (const b of saved) map.set(b.id, structuredClone(b),);
            setSavedSnapshots(map,);
        },
        { defer: false, },
    ),);

    /** Reactive map of blockId → dirty boolean, recalculated whenever
     *  blocks or savedSnapshots change. Using a memo ensures a single
     *  computation rather than per-block function calls inside <For>. */
    const dirtyMap = createMemo(() => {
        const saved = savedSnapshots();
        const map = new Map<string, boolean>();
        for (const b of props.blocks) {
            const s = saved.get(b.id,);
            // New blocks (no saved version) are always dirty
            map.set(b.id, s ? !blockEquals(s, b,) : true,);
        }
        return map;
    },);

    /** Check if a block has unsaved changes compared to saved version. */
    const isBlockDirty = (blockId: string,): boolean => dirtyMap().get(blockId,) ?? false;

    /** Set of dirty block ids — passed down to nested ContentBlocks so
     *  they don't have to know about the dirty map shape. */
    const dirtyBlockIds = createMemo(() => {
        const set = new Set<string>();
        for (const [id, d,] of dirtyMap().entries()) {
            if (d) set.add(id,);
        }
        return set;
    },);

    /** Top-level blocks, sorted by `sort_order` for stable iteration.
     *  Children of group / group_item are filtered out — they render
     *  recursively inside their parent's ContentBlock.
     *
     *  Reads from `storeBlocks` (the reconciled mirror) so each item
     *  is a stable proxy reference; `<For>` can key by identity safely. */
    const topLevelBlocks = createMemo(() =>
        storeBlocks
            .filter(b => b.parentBlockId == null)
            .sort((a, b,) => a.sort_order - b.sort_order,),
    );

    /** Revert a single block to its saved state. */
    const revertBlock = (blockId: string,) => {
        const saved = savedSnapshots().get(blockId);
        if (!saved) return;
        props.onBlocksChange(
            props.blocks.map(b => b.id === blockId ? structuredClone(saved) : b,),
        );
    };

    const selectedBlock = () => {
        const id = selectedBlockId();
        if (!id) return null;
        return props.blocks.find(b => b.id === id,) || null;
    };

    const selectBlock = (id: string,) => {
        setSelectedBlockId(prev => prev === id ? null : id,);
    };

    const deselectBlock = () => {
        setSelectedBlockId(null,);
    };

    // ─── Escape-to-close ───
    //
    // The block edit panel stays open once a block is selected. It only
    // closes when the operator explicitly dismisses it: the panel's X
    // button, selecting a different block, or pressing Escape (an
    // X-equivalent keyboard gesture). Clicking elsewhere on the page no
    // longer deselects — an incidental click outside the panel used to
    // yank it shut mid-edit, which is what we're preventing here.
    const onDocumentKeyDown = (e: KeyboardEvent,) => {
        if (e.key !== 'Escape') return;
        if (!selectedBlockId()) return;
        // Don't steal Escape from an open modal / popover — they close
        // themselves first; the block panel can stay until the next
        // Escape, which lands here once those have torn down.
        if (document.querySelector(
            '.confirm-modal-overlay, .media-select-modal, .media-upload-modal, ' +
            '.social-post-modal-backdrop, .image-block-modal, .add-block-menu__panel, ' +
            '[role="dialog"]',
        )) {
            return;
        }
        deselectBlock();
    };

    onMount(() => {
        document.addEventListener('keydown', onDocumentKeyDown,);
        // Preload the block-style template cache so BlockPreview can
        // resolve `styleRef.templateId` references on the very first
        // paint. Without this, blocks referencing a saved style
        // template rendered un-styled until the operator clicked them
        // (which triggered a re-render that hit the now-populated
        // cache).
        BlockStyleService.preload();
    },);
    onCleanup(() => {
        document.removeEventListener('keydown', onDocumentKeyDown,);
    },);

    // ─── Preview mode controls ───
    const [isMobile, setIsMobile,] = createSignal(false,);
    const [isFullWidth, setIsFullWidth,] = createSignal(false,);
    const [isLandscape, setIsLandscape,] = createSignal(false,);

    // Notify the host editor whenever full-width toggles so it can flip its
    // page root into full-bleed (removing the admin content-column cap).
    createEffect(() => {
        props.onFullWidthChange?.(isFullWidth(),);
    },);
    const [selectedDevice, setSelectedDevice,] = createSignal(DEFAULT_MOBILE_DEVICE,);
    const [showDeviceHeight, setShowDeviceHeight,] = createSignal(false,);

    const deviceWidth = () => isLandscape() ? selectedDevice().height : selectedDevice().width;
    const deviceHeight = () => isLandscape() ? selectedDevice().width : selectedDevice().height;

    const previewContainerStyle = createMemo(() => {
        const base = { ...(props.containerStyle || {}), };
        if (isMobile() && !isFullWidth()) {
            base['max-width'] = `${deviceWidth()}px`;
            base['margin-left'] = 'auto';
            base['margin-right'] = 'auto';
        }
        if (isFullWidth()) {
            delete base['padding-left'];
            delete base['padding-right'];
        }
        return base;
    },);

    const previewContainerClass = createMemo(() => {
        const classes = [props.containerClass || '',];
        if (isMobile()) classes.push('site-preview-container--mobile',);
        if (isFullWidth()) classes.push('site-preview-container--full',);
        return classes.join(' ',).trim();
    },);

    const [draggingId, setDraggingId,] = createSignal<string | null>(null,);
    const [ghostStyle, setGhostStyle,] = createSignal<{ top: number; left: number; width: number; } | null>(null,);
    const [ghostContent, setGhostContent,] = createSignal<string>('',);

    const blockTypes = () => props.blockTypes || getEnabledBlockTypeOptions();

    const changeBlockType = (id: string, newType: BlockType,) => {
        props.onBlocksChange(props.blocks.map(b => {
            if (b.id !== id) return b;
            // Try to carry over compatible data
            const oldData = b.data || {};
            const newData: Record<string, any> = {};
            // Copy content if both types support it
            if (oldData.content) newData.content = oldData.content;
            return { ...b, type: newType, data: newData, };
        },),);
    };

    /**
     * Insert a new block.
     *  - `parentBlockId` (optional) places the block inside that group_item
     *    or group. When null/undefined, the block is added at the top level.
     *  - For type='group', N initial group_item children are created so
     *    the group is immediately usable.
     *  - For group_item containers, only one child is allowed; this call
     *    replaces an existing child if the slot already had one.
     */
    const addBlock = (
        type: BlockType,
        position: 'top' | 'bottom' = 'bottom',
        parentBlockId?: string | null,
        initialData?: Record<string, unknown>,
    ) => {
        const tree = treeify(props.blocks,);

        const newBlock: BlockNode = {
            id: generateBlockId(),
            type,
            parentBlockId: parentBlockId ?? null,
            sort_order: 0,
            // initialData comes from the AddBlockMenu's "recent items"
            // submenu — pre-fills e.g. campaignId / formId / pinnedPostIds
            // so the operator doesn't have to wire it up by hand.
            data: { ...createBlockDefaultData(type,), ...(initialData ?? {}), },
            children: [],
        };

        // For new groups, create the initial group_item children right
        // now so the slot pickers render.
        if (type === 'group') {
            const cols = (newBlock.data.columns as number) || 2;
            for (let i = 0; i < cols; i++) {
                const item = newGroupItem(newBlock.id,);
                newBlock.children.push({ ...item, children: [], },);
            }
        }

        // Find the destination list — the parent's children, or the root
        // tree for top-level inserts.
        let destList: BlockNode[] = tree;
        if (parentBlockId) {
            const found = findInTree(tree, parentBlockId,);
            if (!found) return;
            // group_item slots only hold one child; replace if filled.
            if (found.node.type === 'group_item') {
                found.node.children = [newBlock,];
            } else {
                destList = found.node.children;
                position === 'top' ? destList.unshift(newBlock,) : destList.push(newBlock,);
            }
        } else {
            position === 'top' ? destList.unshift(newBlock,) : destList.push(newBlock,);
        }

        props.onBlocksChange(flattenTree(tree,),);
        setSelectedBlockId(newBlock.id,);
        requestAnimationFrame(() => {
            const el = document.getElementById(newBlock.id,);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', },);
        },);
    };

    /** Convenience for empty group_item slots: add a child to a parent. */
    const addChildBlock = (
        type: BlockType,
        parentId: string,
        initialData?: Record<string, unknown>,
    ) => {
        addBlock(type, 'bottom', parentId, initialData,);
    };

    const updateBlock = (id: string, data: Record<string, any>,) => {
        const scrollY = window.scrollY;
        const prevBlock = props.blocks.find(b => b.id === id);
        const updated = props.blocks.map(b => b.id === id ? { ...b, data, } : b);

        // If a group's columns count changed, sync the number of
        // group_item children to match.
        if (prevBlock?.type === 'group') {
            const prevCols = (prevBlock.data.columns as number) || 0;
            const nextCols = (data.columns as number) || 0;
            if (prevCols !== nextCols) {
                const tree = treeify(updated,);
                const found = findInTree(tree, id,);
                if (found) {
                    const items = found.node.children;
                    if (nextCols > items.length) {
                        for (let i = items.length; i < nextCols; i++) {
                            items.push({ ...newGroupItem(id,), children: [], },);
                        }
                    } else if (nextCols < items.length) {
                        items.length = nextCols;
                    }
                    props.onBlocksChange(flattenTree(tree,),);
                    requestAnimationFrame(() => window.scrollTo(0, scrollY,),);
                    return;
                }
            }
        }

        props.onBlocksChange(updated,);
        requestAnimationFrame(() => window.scrollTo(0, scrollY,),);
    };

    const removeBlock = (id: string,) => {
        if (selectedBlockId() === id) setSelectedBlockId(null,);
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found) return;
        found.parent.splice(found.idx, 1,);
        props.onBlocksChange(flattenTree(tree,),);
    };

    const moveBlockUp = (id: string,) => {
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found || found.idx === 0) return;
        const list = found.parent;
        [list[found.idx - 1], list[found.idx],] = [list[found.idx], list[found.idx - 1],];
        props.onBlocksChange(flattenTree(tree,),);
    };

    const moveBlockDown = (id: string,) => {
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found || found.idx >= found.parent.length - 1) return;
        const list = found.parent;
        [list[found.idx], list[found.idx + 1],] = [list[found.idx + 1], list[found.idx],];
        props.onBlocksChange(flattenTree(tree,),);
    };

    const moveBlockToTop = (id: string,) => {
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found || found.idx === 0) return;
        const [node,] = found.parent.splice(found.idx, 1,);
        found.parent.unshift(node,);
        props.onBlocksChange(flattenTree(tree,),);
    };

    const moveBlockToBottom = (id: string,) => {
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found || found.idx >= found.parent.length - 1) return;
        const [node,] = found.parent.splice(found.idx, 1,);
        found.parent.push(node,);
        props.onBlocksChange(flattenTree(tree,),);
    };

    /** Insert a new empty block immediately before the given one, in the
     *  same parent list. A blank `rich_text` block is the neutral starting
     *  point — the operator can edit it or switch its type. */
    const insertBlockBefore = (id: string,) => {
        const tree = treeify(props.blocks,);
        const found = findInTree(tree, id,);
        if (!found) return;
        const newBlock: BlockNode = {
            id: generateBlockId(),
            type: 'rich_text',
            parentBlockId: found.node.parentBlockId ?? null,
            sort_order: 0,
            data: { ...createBlockDefaultData('rich_text',), },
            children: [],
        };
        found.parent.splice(found.idx, 0, newBlock,);
        props.onBlocksChange(flattenTree(tree,),);
        setSelectedBlockId(newBlock.id,);
        requestAnimationFrame(() => {
            const el = document.getElementById(newBlock.id,);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', },);
        },);
    };

    const handleDragStart = (e: PointerEvent, id: string,) => {
        const blockEl = (e.target as HTMLElement).closest('.content-block',) as HTMLElement;
        if (!blockEl) return;

        // Scope DnD to siblings of the same parent. The dragged block's
        // `data-parent-id` (empty string for top-level) defines which
        // other content-blocks are valid drop targets. Cross-parent
        // drag isn't supported in this phase; nested-group reordering
        // currently uses the up/down buttons.
        const parentSelector = blockEl.dataset.parentId
            ? `[data-parent-id="${blockEl.dataset.parentId}"]`
            : '[data-parent-id=""]';

        const rect = blockEl.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const offsetX = e.clientX - rect.left;

        const typeLabel = blockEl.querySelector('.block-toolbar__type',)?.textContent || '';
        setGhostContent(typeLabel,);
        setGhostStyle({ top: rect.top, left: rect.left, width: rect.width, },);
        setDraggingId(id,);

        // Tree-aware move within the dragged block's parent. Build a
        // siblings array (current order of blocks with the same parent),
        // mutate that, and emit a flat list rebuilt from the rest.
        const draggedParentId: string | null = blockEl.dataset.parentId || null;
        const siblings = () => props.blocks.filter(b => (b.parentBlockId ?? null) === draggedParentId);
        let currentSiblings = siblings();
        let currentIndex = currentSiblings.findIndex(b => b.id === id);

        const handleMove = (moveEvt: PointerEvent,) => {
            moveEvt.preventDefault();

            setGhostStyle(prev =>
                prev ?
                    {
                        ...prev,
                        top: moveEvt.clientY - offsetY,
                        left: moveEvt.clientX - offsetX,
                    } :
                    null
            );

            // Drop targets are sibling content-blocks (same parent only).
            const blockEls = Array.from(
                document.querySelectorAll(`.content-block${parentSelector}`,),
            ) as HTMLElement[];
            const cursorY = moveEvt.clientY;

            let newIndex = currentIndex;
            for (let i = 0; i < blockEls.length; i++) {
                const elRect = blockEls[i].getBoundingClientRect();
                const midY = elRect.top + elRect.height / 2;
                if (cursorY < midY) {
                    newIndex = i;
                    break;
                }
                newIndex = i + 1;
            }
            newIndex = Math.max(
                0,
                Math.min(currentSiblings.length - 1, newIndex > currentIndex ? newIndex - 1 : newIndex,),
            );

            if (newIndex !== currentIndex) {
                const arr = [...currentSiblings,];
                const [item,] = arr.splice(currentIndex, 1,);
                arr.splice(newIndex, 0, item,);
                currentSiblings = arr;
                currentIndex = newIndex;

                // Rebuild via the tree so the parents-before-children
                // invariant survives — descendants travel with their
                // moved parent in the flat array.
                const tree = treeify(props.blocks,);
                const reorderInTree = (nodes: BlockNode[],): boolean => {
                    // Find the sibling list at this level.
                    const allMatch = nodes.length > 0 &&
                        nodes.every(n => (n.parentBlockId ?? null) === draggedParentId);
                    if (allMatch && nodes.some(n => n.id === id)) {
                        nodes.sort((a, b,) => arr.findIndex(s => s.id === a.id) -
                            arr.findIndex(s => s.id === b.id),);
                        return true;
                    }
                    for (const n of nodes) {
                        if (reorderInTree(n.children,)) return true;
                    }
                    return false;
                };
                reorderInTree(tree,);
                props.onBlocksChange(flattenTree(tree,),);
            }
        };

        const handleUp = () => {
            setDraggingId(null,);
            setGhostStyle(null,);
            document.removeEventListener('pointermove', handleMove,);
            document.removeEventListener('pointerup', handleUp,);
        };

        document.addEventListener('pointermove', handleMove,);
        document.addEventListener('pointerup', handleUp,);
    };

    /**
     * The edit panel (flyout + controller). Rendered once per placement
     * (inline-left / inline-right / float) from a single definition so the
     * three can't drift — the float copy previously omitted `isDirty`/
     * `onRevert`, which this unifies. Call inside a `<Show keyed>` so it
     * re-mounts when the selected block changes.
     */
    const renderEditPanel = () => (
        // Reference `selectedBlock()` inside the JSX (not captured once) so the
        // panel's `block` prop stays REACTIVE — when a control updates the
        // block's data (e.g. the default-padding toggle), the controller
        // re-reads it. Rendered inside a `<Show keyed>` on selectedBlockId, so
        // the block is non-null here and only re-mounts on block switch.
        <FlyoutPanel
            title={`Edit: ${titleizeBlockType(selectedBlock()?.type || '',)}`}
            open={true}
            onClose={deselectBlock}
            side={flyoutSide()}
            onSideChange={setFlyoutSide}
            mode={flyoutMode()}
            onModeChange={setFlyoutMode}
        >
            <BlockEditController
                block={selectedBlock()!}
                blockTypes={blockTypes()}
                onUpdate={updateBlock}
                onChangeType={changeBlockType}
                onRemove={(id,) => { removeBlock(id,); deselectBlock(); }}
                onClose={deselectBlock}
                isDirty={selectedBlock() ? isBlockDirty(selectedBlock()!.id,) : false}
                onRevert={() => { const b = selectedBlock(); if (b) revertBlock(b.id,); }}
            />
        </FlyoutPanel>
    );

    return (
        <div class="block-editor">
            {/* Header sits OUTSIDE the styled container */}
            <Show when={props.title || props.blocks.length > 0}>
                <div class="block-editor__header">
                    <Show when={props.title}>
                        <h2 class="block-editor__title">{props.title}</h2>
                    </Show>
                    <div class="block-editor__preview-controls">
                        {/* Mobile toggle */}
                        <button
                            class={`block-editor__mode-btn ${isMobile() ? 'block-editor__mode-btn--active' : ''}`}
                            onClick={() => setIsMobile(!isMobile(),)}
                            title={isMobile() ? 'Switch to desktop' : 'Mobile preview'}
                        >
                            <svg viewBox="0 0 16 16" width="16" height="16">
                                <rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.2" />
                                <line x1="6.5" y1="12" x2="9.5" y2="12" stroke="currentColor" stroke-width="1.2" />
                            </svg>
                        </button>
                        {/* Full-width toggle */}
                        <button
                            class={`block-editor__mode-btn ${isFullWidth() ? 'block-editor__mode-btn--active' : ''}`}
                            onClick={() => setIsFullWidth(!isFullWidth(),)}
                            title={isFullWidth() ? 'Apply padding' : 'Full width (no padding)'}
                        >
                            <svg viewBox="0 0 16 16" width="16" height="16">
                                <rect x="1" y="3" width="14" height="10" rx="1" stroke="currentColor" fill="none" stroke-width="1.2" />
                                <path d="M4 6l-2 2 2 2M12 6l2 2-2 2" stroke="currentColor" fill="none" stroke-width="1.2" />
                            </svg>
                        </button>
                    </div>
                </div>
                {/* Mobile device picker — shown when mobile mode is on */}
                <Show when={isMobile()}>
                    <div class="block-editor__mobile-bar">
                        <select
                            class="block-editor__device-select"
                            value={selectedDevice().name}
                            onChange={(e,) => {
                                const dev = MOBILE_DEVICES.find(d => d.name === e.currentTarget.value,);
                                if (dev) setSelectedDevice(dev,);
                            }}
                        >
                            <For each={MOBILE_DEVICES}>
                                {(d,) => <option value={d.name}>{d.name} ({d.width}×{d.height})</option>}
                            </For>
                        </select>
                        <button
                            class={`block-editor__mode-btn ${isLandscape() ? 'block-editor__mode-btn--active' : ''}`}
                            onClick={() => setIsLandscape(!isLandscape(),)}
                            title={isLandscape() ? 'Portrait' : 'Landscape'}
                            style={{ width: '28px', height: '28px', }}
                        >
                            <svg viewBox="0 0 16 16" width="14" height="14">
                                <Show when={!isLandscape()}>
                                    <rect x="4" y="1" width="8" height="14" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.2" />
                                </Show>
                                <Show when={isLandscape()}>
                                    <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" fill="none" stroke-width="1.2" />
                                </Show>
                            </svg>
                        </button>
                        <Toggle
                            checked={showDeviceHeight()}
                            onChange={setShowDeviceHeight}
                            label="Show fold"
                            size="sm"
                        />
                    </div>
                </Show>
            </Show>
            {/* Add Block (top) — only shown when there's at least one block */}
            <Show when={props.blocks.length > 0}>
                <div class="add-block-dropdown add-block-dropdown--top">
                    <AddBlockMenu
                        triggerSize="small"
                        types={blockTypes()}
                        onSelect={(type, initialData,) => addBlock(type, 'top', null, initialData,)}
                    />
                </div>
            </Show>
            {/* ─── Content area: blocks + optional inline flyout ─── */}
            <div class={`block-editor__content-row ${
                selectedBlock() && flyoutMode() === 'inline' ?
                    `block-editor__content-row--with-panel block-editor__content-row--panel-${flyoutSide()}` :
                    ''
            }`}>
                {/* Inline flyout on the LEFT — keyed by block ID to force re-mount on switch */}
                <Show when={selectedBlock() && flyoutMode() === 'inline' && flyoutSide() === 'left' ? selectedBlockId() : null} keyed>
                    {(_blockId,) => renderEditPanel()}
                </Show>

                {/* Blocks column */}
                <div class="block-editor__blocks-column">
                    <div class="block-editor__preview-frame" style={{
                        'max-width': isMobile() && !isFullWidth() ? `${deviceWidth()}px` : undefined,
                        'margin': isMobile() && !isFullWidth() ? '0 auto' : undefined,
                        'position': 'relative',
                    }}>
                        <div
                            class={`content-blocks-list ${draggingId() ? 'content-blocks-list--dragging' : ''} ${previewContainerClass()}`}
                            style={previewContainerStyle()}
                        >
                            {/* `<For>` keys by reference identity. With
                                the reconcile-backed store above, item
                                proxies survive data updates, so a
                                keystroke in an inline editor doesn't
                                remount the row — focus stays put. */}
                            <For
                                each={topLevelBlocks()}
                                fallback={
                                    <div class="block-editor__empty">
                                        Click <strong>+ Add Block</strong> below to add content blocks.
                                    </div>
                                }
                            >
                                {(block, index,) => (
                                    <ContentBlock
                                        block={block}
                                        index={index()}
                                        total={topLevelBlocks().length}
                                        allBlocks={storeBlocks}
                                        isSelected={selectedBlockId() === block.id}
                                        isDirty={isBlockDirty(block.id,)}
                                        isEditing={false}
                                        isDragging={draggingId() === block.id}
                                        collapsed={false}
                                        selectedBlockId={selectedBlockId()}
                                        dirtyBlockIds={dirtyBlockIds()}
                                        draggingId={draggingId()}
                                        onToggleEdit={() => selectBlock(block.id,)}
                                        onCancel={deselectBlock}
                                        onUpdate={updateBlock}
                                        onRemove={removeBlock}
                                        onMoveUp={moveBlockUp}
                                        onMoveDown={moveBlockDown}
                                        onMoveToTop={moveBlockToTop}
                                        onMoveToBottom={moveBlockToBottom}
                                        onInsertBefore={insertBlockBefore}
                                        onDragStart={handleDragStart}
                                        onAddChildBlock={addChildBlock}
                                        blockTypes={blockTypes()}
                                        onChangeType={changeBlockType}
                                    />
                                )}
                            </For>
                        </div>
                        <Show when={isMobile() && showDeviceHeight() && !isFullWidth()}>
                            <div class="block-editor__fold-mask" style={{ top: `${deviceHeight()}px`, }} />
                        </Show>
                    </div>
                    <Show when={ghostStyle()}>
                        {(style,) => (
                            <div class="content-block-ghost" style={{
                                position: 'fixed',
                                top: `${style().top}px`,
                                left: `${style().left}px`,
                                width: `${style().width}px`,
                            }}>
                                <div class="content-block-ghost__inner">
                                    <span class="content-block-ghost__icon">&#9776;</span>
                                    <span class="content-block-ghost__label">{ghostContent()}</span>
                                </div>
                            </div>
                        )}
                    </Show>
                    <div class="add-block-dropdown">
                        <AddBlockMenu
                            types={blockTypes()}
                            onSelect={(type, initialData,) => addBlock(type, 'bottom', null, initialData,)}
                        />
                    </div>
                </div>

                {/* Inline flyout on the RIGHT — keyed by block ID */}
                <Show when={selectedBlock() && flyoutMode() === 'inline' && flyoutSide() === 'right' ? selectedBlockId() : null} keyed>
                    {(_blockId,) => renderEditPanel()}
                </Show>
            </div>

            {/* ─── Floating flyout (only when in float mode) — keyed by block ID ─── */}
            <Show when={selectedBlock() && flyoutMode() === 'float' ? selectedBlockId() : null} keyed>
                {(_blockId,) => renderEditPanel()}
            </Show>
        </div>
    );
};

export default BlockEditor;
