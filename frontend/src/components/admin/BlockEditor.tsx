import { Component, createEffect, createMemo, createSignal, For, on, Show, } from 'solid-js';
import { createBlockDefaultData, getEnabledBlockTypeOptions, } from '../../config/blockTypes';
import { DEFAULT_MOBILE_DEVICE, MOBILE_DEVICES, } from '../../config/mobileDevices';
import AddBlockMenu from './AddBlockMenu';
import BlockEditController from './BlockEditController';
import ContentBlock, { BlockData, BlockType, } from './ContentBlock';
import FlyoutPanel, { type FlyoutMode, } from './FlyoutPanel';

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
}

/**
 * Block types come from the central registry in `config/blockTypes.ts`.
 * Editors can still pass a custom `blockTypes` prop to restrict the
 * list (e.g. an embed-only context), but by default we surface every
 * registered+enabled type.
 */

let blockIdCounter = 0;
const generateBlockId = () => `block-${Date.now()}-${++blockIdCounter}`;

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

    // ─── Preview mode controls ───
    const [isMobile, setIsMobile,] = createSignal(false,);
    const [isFullWidth, setIsFullWidth,] = createSignal(false,);
    const [isLandscape, setIsLandscape,] = createSignal(false,);
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

    const addBlock = (type: BlockType, position: 'top' | 'bottom' = 'bottom',) => {
        const currentBlocks = props.blocks;
        // Initial data (including the per-type "default padding" rule)
        // comes from the central registry — see config/blockTypes.ts.
        const newBlock: BlockData = {
            id: generateBlockId(),
            type,
            sort_order: 0,
            data: createBlockDefaultData(type,),
        };
        const updated = position === 'top' ?
            [newBlock, ...currentBlocks,] :
            [...currentBlocks, newBlock,];
        props.onBlocksChange(updated.map((b, i,) => ({ ...b, sort_order: i, })),);
        // Auto-select the new block to open it in the flyout. The
        // AddBlockMenu component closes itself on selection.
        setSelectedBlockId(newBlock.id,);

        requestAnimationFrame(() => {
            const el = document.getElementById(newBlock.id,);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', },);
            }
        },);
    };

    const updateBlock = (id: string, data: Record<string, any>,) => {
        const scrollY = window.scrollY;
        props.onBlocksChange(props.blocks.map(b => b.id === id ? { ...b, data, } : b),);
        // Preserve scroll — block updates create new references which cause
        // <For> to remount ContentBlock, potentially triggering Suspense.
        requestAnimationFrame(() => window.scrollTo(0, scrollY,),);
    };

    const removeBlock = (id: string,) => {
        if (selectedBlockId() === id) setSelectedBlockId(null,);
        props.onBlocksChange(props.blocks.filter(b => b.id !== id).map((b, i,) => ({ ...b, sort_order: i, })),);
    };

    const moveBlockUp = (id: string,) => {
        const idx = props.blocks.findIndex(b => b.id === id);
        if (idx <= 0) return;
        const arr = [...props.blocks,];
        [arr[idx - 1], arr[idx],] = [arr[idx], arr[idx - 1],];
        props.onBlocksChange(arr.map((b, i,) => ({ ...b, sort_order: i, })),);
    };

    const moveBlockDown = (id: string,) => {
        const idx = props.blocks.findIndex(b => b.id === id);
        if (idx < 0 || idx >= props.blocks.length - 1) return;
        const arr = [...props.blocks,];
        [arr[idx], arr[idx + 1],] = [arr[idx + 1], arr[idx],];
        props.onBlocksChange(arr.map((b, i,) => ({ ...b, sort_order: i, })),);
    };

    const moveBlockToTop = (id: string,) => {
        const idx = props.blocks.findIndex(b => b.id === id);
        if (idx <= 0) return;
        const block = props.blocks[idx];
        const rest = props.blocks.filter(b => b.id !== id);
        props.onBlocksChange([block, ...rest,].map((b, i,) => ({ ...b, sort_order: i, })),);
    };

    const moveBlockToBottom = (id: string,) => {
        const idx = props.blocks.findIndex(b => b.id === id);
        if (idx < 0 || idx >= props.blocks.length - 1) return;
        const block = props.blocks[idx];
        const rest = props.blocks.filter(b => b.id !== id);
        props.onBlocksChange([...rest, block,].map((b, i,) => ({ ...b, sort_order: i, })),);
    };

    const handleDragStart = (e: PointerEvent, id: string,) => {
        const blockEl = (e.target as HTMLElement).closest('.content-block',) as HTMLElement;
        if (!blockEl) return;

        const rect = blockEl.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const offsetX = e.clientX - rect.left;

        const typeLabel = blockEl.querySelector('.block-toolbar__type',)?.textContent || '';
        setGhostContent(typeLabel,);
        setGhostStyle({ top: rect.top, left: rect.left, width: rect.width, },);
        setDraggingId(id,);

        const listEl = blockEl.parentElement;
        let currentBlocks = [...props.blocks,];
        let currentIndex = currentBlocks.findIndex(b => b.id === id);

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

            if (!listEl) return;
            const blockEls = Array.from(listEl.querySelectorAll('.content-block',),) as HTMLElement[];
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
                Math.min(currentBlocks.length - 1, newIndex > currentIndex ? newIndex - 1 : newIndex,),
            );

            if (newIndex !== currentIndex) {
                const arr = [...currentBlocks,];
                const [item,] = arr.splice(currentIndex, 1,);
                arr.splice(newIndex, 0, item,);
                currentBlocks = arr;
                currentIndex = newIndex;
                props.onBlocksChange(arr.map((b, i,) => ({ ...b, sort_order: i, })),);
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
                        <label class="block-editor__height-toggle">
                            <input
                                type="checkbox"
                                checked={showDeviceHeight()}
                                onChange={(e,) => setShowDeviceHeight(e.currentTarget.checked,)}
                            />
                            <span>Show fold</span>
                        </label>
                    </div>
                </Show>
            </Show>
            {/* Add Block (top) — only shown when there's at least one block */}
            <Show when={props.blocks.length > 0}>
                <div class="add-block-dropdown add-block-dropdown--top">
                    <AddBlockMenu
                        triggerSize="small"
                        types={blockTypes()}
                        onSelect={(type,) => addBlock(type, 'top',)}
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
                    {(_blockId,) => (
                        <FlyoutPanel
                            title={`Edit: ${(selectedBlock()!.type || '').replace(/_/g, ' ',).replace(/\b\w/g, c => c.toUpperCase(),)}`}
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
                                isDirty={isBlockDirty(selectedBlock()!.id,)}
                                onRevert={() => revertBlock(selectedBlock()!.id,)}
                            />
                        </FlyoutPanel>
                    )}
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
                            <For
                                each={props.blocks}
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
                                        total={props.blocks.length}
                                        isSelected={selectedBlockId() === block.id}
                                        isDirty={isBlockDirty(block.id,)}
                                        isEditing={false}
                                        isDragging={draggingId() === block.id}
                                        collapsed={false}
                                        onToggleEdit={() => selectBlock(block.id,)}
                                        onCancel={deselectBlock}
                                        onUpdate={updateBlock}
                                        onRemove={removeBlock}
                                        onMoveUp={moveBlockUp}
                                        onMoveDown={moveBlockDown}
                                        onMoveToTop={moveBlockToTop}
                                        onMoveToBottom={moveBlockToBottom}
                                        onDragStart={handleDragStart}
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
                            onSelect={(type,) => addBlock(type,)}
                        />
                    </div>
                </div>

                {/* Inline flyout on the RIGHT — keyed by block ID */}
                <Show when={selectedBlock() && flyoutMode() === 'inline' && flyoutSide() === 'right' ? selectedBlockId() : null} keyed>
                    {(_blockId,) => (
                        <FlyoutPanel
                            title={`Edit: ${(selectedBlock()!.type || '').replace(/_/g, ' ',).replace(/\b\w/g, c => c.toUpperCase(),)}`}
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
                                isDirty={isBlockDirty(selectedBlock()!.id,)}
                                onRevert={() => revertBlock(selectedBlock()!.id,)}
                            />
                        </FlyoutPanel>
                    )}
                </Show>
            </div>

            {/* ─── Floating flyout (only when in float mode) — keyed by block ID ─── */}
            <Show when={selectedBlock() && flyoutMode() === 'float' ? selectedBlockId() : null} keyed>
                {(_blockId,) => (
                    <FlyoutPanel
                        title={`Edit: ${(selectedBlock()!.type || '').replace(/_/g, ' ',).replace(/\b\w/g, c => c.toUpperCase(),)}`}
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
                        />
                    </FlyoutPanel>
                )}
            </Show>
        </div>
    );
};

export default BlockEditor;
