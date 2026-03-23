import { Component, createSignal, For, Index, Show, } from 'solid-js';
import ContentBlock, { BlockData, BlockType, } from './ContentBlock';

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
}

const DEFAULT_BLOCK_TYPES: BlockTypeOption[] = [
    { type: 'text', label: 'Text', },
    { type: 'social_media', label: 'Social Media', },
    { type: 'image', label: 'Image', },
    { type: 'video', label: 'Video', },
    { type: 'document', label: 'Document', },
    { type: 'url_link', label: 'URL Link', },
];

let blockIdCounter = 0;
const generateBlockId = () => `block-${Date.now()}-${++blockIdCounter}`;

const BlockEditor: Component<BlockEditorProps> = (props,) => {
    const [editingBlocks, setEditingBlocks,] = createSignal<Set<string>>(new Set(),);
    const [originalBlockData, setOriginalBlockData,] = createSignal<Map<string, Record<string, any>>>(new Map(),);
    const [collapsedBlocks, setCollapsedBlocks,] = createSignal<Set<string>>(new Set(),);
    const [showAddDropdown, setShowAddDropdown,] = createSignal(false,);

    const expandAll = () => setCollapsedBlocks(new Set(),);
    const collapseAll = () => setCollapsedBlocks(new Set(props.blocks.map(b => b.id),),);
    const toggleCollapse = (id: string,) => {
        setCollapsedBlocks(prev => {
            const next = new Set(prev,);
            if (next.has(id,)) next.delete(id,);
            else next.add(id,);
            return next;
        },);
    };
    const [draggingId, setDraggingId,] = createSignal<string | null>(null,);
    const [ghostStyle, setGhostStyle,] = createSignal<{ top: number; left: number; width: number; } | null>(null,);
    const [ghostContent, setGhostContent,] = createSignal<string>('',);

    const blockTypes = () => props.blockTypes || DEFAULT_BLOCK_TYPES;

    const toggleEditBlock = (id: string,) => {
        const isCurrentlyEditing = editingBlocks().has(id,);
        if (!isCurrentlyEditing) {
            const block = props.blocks.find(b => b.id === id);
            if (block) {
                setOriginalBlockData(prev => {
                    const next = new Map(prev,);
                    next.set(id, { ...block.data, },);
                    return next;
                },);
            }
        } else {
            setOriginalBlockData(prev => {
                const next = new Map(prev,);
                next.delete(id,);
                return next;
            },);
        }
        setEditingBlocks(prev => {
            const next = new Set(prev,);
            if (next.has(id,)) {
                next.delete(id,);
            } else {
                next.add(id,);
            }
            return next;
        },);
    };

    const cancelEditBlock = (id: string,) => {
        const original = originalBlockData().get(id,);
        if (original) {
            props.onBlocksChange(props.blocks.map(b => b.id === id ? { ...b, data: original, } : b),);
        }
        setOriginalBlockData(prev => {
            const next = new Map(prev,);
            next.delete(id,);
            return next;
        },);
        setEditingBlocks(prev => {
            const next = new Set(prev,);
            next.delete(id,);
            return next;
        },);
    };

    const addBlock = (type: BlockType,) => {
        const currentBlocks = props.blocks;
        const newBlock: BlockData = {
            id: generateBlockId(),
            type,
            sort_order: currentBlocks.length,
            data: {},
        };
        props.onBlocksChange([...currentBlocks, newBlock,],);
        setEditingBlocks(prev => {
            const next = new Set(prev,);
            next.add(newBlock.id,);
            return next;
        },);
        setShowAddDropdown(false,);
    };

    const updateBlock = (id: string, data: Record<string, any>,) => {
        props.onBlocksChange(props.blocks.map(b => b.id === id ? { ...b, data, } : b),);
    };

    const removeBlock = (id: string,) => {
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
            <Show when={props.title || props.blocks.length > 0}>
                <div class="block-editor__header">
                    <Show when={props.title}>
                        <h2 class="block-editor__title">{props.title}</h2>
                    </Show>
                    <Show when={props.blocks.length > 0}>
                        <div class="block-editor__toolbar">
                            <button class="btn btn--xs btn--link" onClick={expandAll}>Expand All</button>
                            <button class="btn btn--xs btn--link" onClick={collapseAll}>Collapse All</button>
                        </div>
                    </Show>
                </div>
            </Show>
            <div class={`content-blocks-list ${draggingId() ? 'content-blocks-list--dragging' : ''}`}>
                <Index
                    each={props.blocks}
                    fallback={<div class="empty-state">No content blocks yet. Add one below.</div>}
                >
                    {(block, index,) => (
                        <ContentBlock
                            block={block()}
                            index={index}
                            total={props.blocks.length}
                            isEditing={editingBlocks().has(block().id,)}
                            isDragging={draggingId() === block().id}
                            collapsed={collapsedBlocks().has(block().id,)}
                            onToggleEdit={toggleEditBlock}
                            onCancel={cancelEditBlock}
                            onUpdate={updateBlock}
                            onRemove={removeBlock}
                            onMoveUp={moveBlockUp}
                            onMoveDown={moveBlockDown}
                            onDragStart={handleDragStart}
                            onToggleCollapse={toggleCollapse}
                        />
                    )}
                </Index>
            </div>
            <Show when={ghostStyle()}>
                {(style,) => (
                    <div
                        class="content-block-ghost"
                        style={{
                            position: 'fixed',
                            top: `${style().top}px`,
                            left: `${style().left}px`,
                            width: `${style().width}px`,
                        }}
                    >
                        <div class="content-block-ghost__inner">
                            <span class="content-block-ghost__icon">&#9776;</span>
                            <span class="content-block-ghost__label">{ghostContent()}</span>
                        </div>
                    </div>
                )}
            </Show>
            <div class="add-block-dropdown">
                <button class="btn btn--secondary" onClick={() => setShowAddDropdown(!showAddDropdown(),)}>
                    + Add Block
                </button>
                <Show when={showAddDropdown()}>
                    <div class="add-block-dropdown__menu">
                        <For each={blockTypes()}>
                            {(bt,) => (
                                <button class="add-block-dropdown__item" onClick={() => addBlock(bt.type,)}>
                                    {bt.label}
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default BlockEditor;
