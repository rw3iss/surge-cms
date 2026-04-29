import { Component, createSignal, For, Match, Show, Switch, } from 'solid-js';
import { type BlockType, getBlockLabel, } from '../../../config/blockTypes';
import AddBlockMenu from './AddBlockMenu';
import BlockPreview from './BlockPreview';
import ConfirmModal from '../common/ConfirmModal';

// Re-export so existing imports `{ BlockType } from './ContentBlock'`
// keep working without churn — but this file no longer owns the union.
// New code should import directly from '../../../config/blockTypes'.
export type { BlockType, };

export interface BlockData {
    id: string;
    type: BlockType;
    /** Parent block id; null/undefined for top-level blocks. Children of
     *  a group/group_item carry this so the editor can assemble a tree. */
    parentBlockId?: string | null;
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
    /** Full flat list of blocks on the page — needed for groups to find
     *  their children. */
    allBlocks: BlockData[];
    isSelected?: boolean;
    isDirty?: boolean;
    isEditing: boolean;
    isDragging: boolean;
    collapsed?: boolean;
    selectedBlockId?: string | null;
    dirtyBlockIds?: Set<string>;
    draggingId?: string | null;
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
    /** Add a child block to a parent (group / group_item). Used by the
     *  empty-slot AddBlockMenu inside groups. */
    onAddChildBlock?: (type: BlockType, parentId: string,) => void;
    blockTypes?: Array<{ type: BlockType; label: string; }>;
    onChangeType?: (id: string, newType: BlockType,) => void;
}

// Labels come from the central registry — see config/blockTypes.ts.

/**
 * Content block in preview-only mode. Clicking selects it and opens
 * the flyout editor panel. Hover shows a floating toolbar with move
 * and options controls.
 *
 * For group / group_item types the preview body recurses into nested
 * ContentBlocks so the user can manage children in place.
 */
const ContentBlock: Component<ContentBlockProps> = (props,) => {
    const [showRemoveConfirm, setShowRemoveConfirm,] = createSignal(false,);
    const [showOptionsMenu, setShowOptionsMenu,] = createSignal(false,);

    const childBlocks = () =>
        props.allBlocks.filter(b => b.parentBlockId === props.block.id)
            .sort((a, b,) => a.sort_order - b.sort_order,);

    return (
        <div
            id={props.block.id}
            class={`content-block content-block--preview content-block--${props.block.type} ${
                props.isSelected ? 'content-block--selected' : ''
            } ${props.isDragging ? 'content-block--dragging' : ''}`}
            onClick={(e,) => {
                if ((e.target as HTMLElement).closest('button, .content-block__hover-drag, .content-block__options-menu, .add-block-dropdown',)) return;
                e.stopPropagation();
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
                <Switch>
                    <Match when={props.block.type === 'group'}>
                        <GroupBlockPreview
                            block={props.block}
                            childBlocks={childBlocks()}
                            allBlocks={props.allBlocks}
                            ownProps={props}
                        />
                    </Match>
                    <Match when={props.block.type === 'group_item'}>
                        <GroupItemPreview
                            block={props.block}
                            childBlocks={childBlocks()}
                            allBlocks={props.allBlocks}
                            ownProps={props}
                        />
                    </Match>
                    <Match when={true}>
                        <BlockPreview block={props.block} />
                    </Match>
                </Switch>
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

// ─── Group + group_item preview helpers ──────────────────────────────

interface NestedPreviewProps {
    block: BlockData;
    childBlocks: BlockData[];
    allBlocks: BlockData[];
    /** The parent ContentBlock's props — re-passed to nested ContentBlocks
     *  so children share the same set of editor callbacks. */
    ownProps: ContentBlockProps;
}

const GroupBlockPreview: Component<NestedPreviewProps> = (props,) => {
    const data = () => props.block.data;
    const direction = () => (data().direction as string) || 'horizontal';
    const containerStyle = (): Record<string, string> => ({
        display: 'flex',
        'flex-direction': direction() === 'vertical' ? 'column' : 'row',
        'flex-wrap': (data().wrap as string) || 'wrap',
        gap: (data().gap as string) || '12px',
        'align-items': (data().align as string) || 'stretch',
        'justify-content': (data().justify as string) || 'flex-start',
        'min-height': '60px',
    });

    return (
        <div class="content-block__group" style={containerStyle()}>
            <For each={props.childBlocks}>
                {(child, idx,) => (
                    <ContentBlock
                        block={child}
                        index={idx()}
                        total={props.childBlocks.length}
                        allBlocks={props.allBlocks}
                        isSelected={props.ownProps.selectedBlockId === child.id}
                        isDirty={props.ownProps.dirtyBlockIds?.has(child.id,) ?? false}
                        isEditing={false}
                        isDragging={props.ownProps.draggingId === child.id}
                        collapsed={false}
                        selectedBlockId={props.ownProps.selectedBlockId}
                        dirtyBlockIds={props.ownProps.dirtyBlockIds}
                        draggingId={props.ownProps.draggingId}
                        onToggleEdit={props.ownProps.onToggleEdit}
                        onCancel={props.ownProps.onCancel}
                        onUpdate={props.ownProps.onUpdate}
                        onRemove={props.ownProps.onRemove}
                        onMoveUp={props.ownProps.onMoveUp}
                        onMoveDown={props.ownProps.onMoveDown}
                        onMoveToTop={props.ownProps.onMoveToTop}
                        onMoveToBottom={props.ownProps.onMoveToBottom}
                        onDragStart={props.ownProps.onDragStart}
                        onAddChildBlock={props.ownProps.onAddChildBlock}
                        blockTypes={props.ownProps.blockTypes}
                        onChangeType={props.ownProps.onChangeType}
                    />
                )}
            </For>
        </div>
    );
};

const GroupItemPreview: Component<NestedPreviewProps> = (props,) => {
    const data = () => props.block.data;
    const slotStyle = () => ({
        flex: '1 1 0',
        'min-width': (data().minWidth as string) || (data().width as string) || '120px',
        'max-width': (data().maxWidth as string) || undefined,
        width: (data().width as string) || undefined,
        'min-height': (data().minHeight as string) || '80px',
        'max-height': (data().maxHeight as string) || undefined,
        height: (data().height as string) || undefined,
        'align-self': (data().alignSelf as string) || undefined,
    });

    return (
        <div class="content-block__group-item" style={slotStyle()}>
            <Show
                when={props.childBlocks.length > 0}
                fallback={
                    <div class="content-block__group-item-empty">
                        <Show when={props.ownProps.onAddChildBlock && props.ownProps.blockTypes}>
                            <AddBlockMenu
                                triggerSize="small"
                                types={(props.ownProps.blockTypes ?? []).filter(
                                    t => t.type !== 'group_item',
                                )}
                                onSelect={(type,) =>
                                    props.ownProps.onAddChildBlock!(type, props.block.id,)}
                            />
                        </Show>
                    </div>
                }
            >
                <For each={props.childBlocks}>
                    {(child, idx,) => (
                        <ContentBlock
                            block={child}
                            index={idx()}
                            total={props.childBlocks.length}
                            allBlocks={props.allBlocks}
                            isSelected={props.ownProps.selectedBlockId === child.id}
                            isDirty={props.ownProps.dirtyBlockIds?.has(child.id,) ?? false}
                            isEditing={false}
                            isDragging={props.ownProps.draggingId === child.id}
                            collapsed={false}
                            selectedBlockId={props.ownProps.selectedBlockId}
                            dirtyBlockIds={props.ownProps.dirtyBlockIds}
                            draggingId={props.ownProps.draggingId}
                            onToggleEdit={props.ownProps.onToggleEdit}
                            onCancel={props.ownProps.onCancel}
                            onUpdate={props.ownProps.onUpdate}
                            onRemove={props.ownProps.onRemove}
                            onMoveUp={props.ownProps.onMoveUp}
                            onMoveDown={props.ownProps.onMoveDown}
                            onMoveToTop={props.ownProps.onMoveToTop}
                            onMoveToBottom={props.ownProps.onMoveToBottom}
                            onDragStart={props.ownProps.onDragStart}
                            onAddChildBlock={props.ownProps.onAddChildBlock}
                            blockTypes={props.ownProps.blockTypes}
                            onChangeType={props.ownProps.onChangeType}
                        />
                    )}
                </For>
            </Show>
        </div>
    );
};

export default ContentBlock;
