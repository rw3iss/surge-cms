import { Component, createSignal, Show, } from 'solid-js';
import { type BlockType, getBlockLabel, } from '../../config/blockTypes';
import BlockPreview from './BlockPreview';
import ConfirmModal from './ConfirmModal';

// Re-export so existing imports `{ BlockType } from './ContentBlock'`
// keep working without churn — but this file no longer owns the union.
// New code should import directly from '../../config/blockTypes'.
export type { BlockType, };

export interface BlockData {
    id: string;
    type: BlockType;
    sort_order: number;
    data: Record<string, any>;
    styleRef?: {
        templateId?: string;
        custom?: Record<string, any>;
    };
}

interface ContentBlockProps {
    block: BlockData;
    index: number;
    total: number;
    isSelected?: boolean;
    isDirty?: boolean;
    isEditing: boolean;
    isDragging: boolean;
    collapsed?: boolean;
    onToggleEdit: (id: string,) => void;
    onCancel: (id: string,) => void;
    onUpdate: (id: string, data: Record<string, any>,) => void;
    onRemove: (id: string,) => void;
    onMoveUp: (id: string,) => void;
    onMoveDown: (id: string,) => void;
    onMoveToTop?: (id: string,) => void;
    onMoveToBottom?: (id: string,) => void;
    onDragStart: (e: PointerEvent, id: string,) => void;
    onToggleCollapse?: (id: string,) => void;
    blockTypes?: Array<{ type: BlockType; label: string; }>;
    onChangeType?: (id: string, newType: BlockType,) => void;
}

// Labels come from the central registry — see config/blockTypes.ts.

/**
 * Content block in preview-only mode. Clicking selects it and opens
 * the flyout editor panel. Hover shows a floating toolbar with move
 * and options controls.
 *
 * All edit forms have been moved to BlockEditController.tsx which
 * renders inside the FlyoutPanel.
 */
const ContentBlock: Component<ContentBlockProps> = (props,) => {
    const [showRemoveConfirm, setShowRemoveConfirm,] = createSignal(false,);
    const [showOptionsMenu, setShowOptionsMenu,] = createSignal(false,);

    return (
        <div
            id={props.block.id}
            class={`content-block content-block--preview ${
                props.isSelected ? 'content-block--selected' : ''
            } ${props.isDragging ? 'content-block--dragging' : ''}`}
            onClick={(e,) => {
                if ((e.target as HTMLElement).closest('button, .content-block__hover-drag, .content-block__options-menu',)) return;
                props.onToggleEdit(props.block.id,);
            }}
            onPointerDown={(e,) => {
                if ((e.target as HTMLElement).closest('.content-block__hover-drag',)) {
                    props.onDragStart(e, props.block.id,);
                }
            }}
        >
            {/* Floating hover bar */}
            <div class={`content-block__hover-bar${props.isDirty ? ' content-block__hover-bar--dirty' : ''}`}>
                <span class="content-block__hover-drag" title="Drag to reorder">
                    &#9776;
                </span>
                <span class="content-block__hover-label">
                    {getBlockLabel(props.block.type,)}
                </span>
                <button
                    class="content-block__hover-btn"
                    onClick={() => props.onMoveUp(props.block.id,)}
                    disabled={props.index === 0}
                    title="Move up"
                >
                    &#9650;
                </button>
                <button
                    class="content-block__hover-btn"
                    onClick={() => props.onMoveDown(props.block.id,)}
                    disabled={props.index === props.total - 1}
                    title="Move down"
                >
                    &#9660;
                </button>
                <div class="content-block__options-wrap">
                    <button
                        class="content-block__hover-btn content-block__hover-btn--options"
                        onClick={() => setShowOptionsMenu(!showOptionsMenu(),)}
                        title="Options"
                    >
                        &#8943;
                    </button>
                    <Show when={showOptionsMenu()}>
                        <div class="content-block__options-menu">
                            <button onClick={() => { props.onToggleEdit(props.block.id,); setShowOptionsMenu(false,); }}>
                                Edit
                            </button>
                            <Show when={props.index > 0}>
                                <button onClick={() => { props.onMoveToTop?.(props.block.id,); setShowOptionsMenu(false,); }}>
                                    Move to Top
                                </button>
                            </Show>
                            <Show when={props.index < props.total - 1}>
                                <button onClick={() => { props.onMoveToBottom?.(props.block.id,); setShowOptionsMenu(false,); }}>
                                    Move to Bottom
                                </button>
                            </Show>
                            <button
                                class="content-block__options-danger"
                                onClick={() => { setShowRemoveConfirm(true,); setShowOptionsMenu(false,); }}
                            >
                                Delete
                            </button>
                        </div>
                    </Show>
                </div>
            </div>

            {/* Block preview */}
            <div class="content-block__preview-body">
                <BlockPreview block={props.block} />
            </div>

            <ConfirmModal
                open={showRemoveConfirm()}
                title="Remove Block"
                message="Are you sure you want to remove this content block?"
                confirmLabel="Remove"
                onConfirm={() => {
                    setShowRemoveConfirm(false,);
                    props.onRemove(props.block.id,);
                }}
                onCancel={() => setShowRemoveConfirm(false,)}
                danger={true}
            />
        </div>
    );
};

export default ContentBlock;
