import { Component, createEffect, createSignal, For, Match, onCleanup, Show, Switch, } from 'solid-js';
import { type BlockType, getBlockLabel, } from '../../../config/blockTypes';
import AddBlockMenu from './AddBlockMenu';
import BlockPreview from './BlockPreview';
import HtmlInlineEditor from './HtmlInlineEditor';
import RichTextEditor from '../editors/RichTextEditor';
import ConfirmModal from '../common/ConfirmModal';
import { groupContainerStyle, } from '../../../utils/groupStyle';

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
    /** Insert a new empty block immediately before this one (same parent). */
    onInsertBefore?: (id: string,) => void;
    onDragStart: (e: PointerEvent, id: string,) => void;
    onToggleCollapse?: (id: string,) => void;
    /** Add a child block to a parent (group / group_item). Used by the
     *  empty-slot AddBlockMenu inside groups. `initialData` carries
     *  the pre-filled id when the user picked from a recent-items
     *  submenu. */
    onAddChildBlock?: (type: BlockType, parentId: string, initialData?: Record<string, unknown>,) => void;
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
    // Collapse/minimize the block's preview body (local UI state). A block
    // that loads already disabled starts collapsed by default — disabled
    // blocks are hidden on the public site, so there's little reason to keep
    // their (greyed-out) preview expanded in the editor on load.
    const [isCollapsed, setIsCollapsed,] = createSignal(Boolean(props.block.data?.disabled,),);

    /** A disabled block keeps its content but renders greyed-out in the editor
     *  and not at all on the public site (see BlockRenderer). Stored on the
     *  block's data so it round-trips through save/load. */
    const isDisabled = () => Boolean(props.block.data?.disabled);
    const toggleDisabled = () => {
        props.onUpdate(props.block.id, { ...props.block.data, disabled: !isDisabled(), },);
    };

    // Options ('…') menu dismissal:
    //  1. Click anywhere outside the options-wrap closes it.
    //  2. Hovering off the menu for >500ms closes it; moving back on
    //     (which re-enters the wrap) cancels the pending close.
    let optionsWrapRef: HTMLDivElement | undefined;
    let hoverCloseTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelHoverClose = () => {
        if (hoverCloseTimer) {
            clearTimeout(hoverCloseTimer,);
            hoverCloseTimer = undefined;
        }
    };
    const scheduleHoverClose = () => {
        cancelHoverClose();
        hoverCloseTimer = setTimeout(() => setShowOptionsMenu(false,), 500,);
    };

    createEffect(() => {
        if (!showOptionsMenu()) {
            cancelHoverClose();
            return;
        }
        const onDocPointerDown = (e: PointerEvent,) => {
            if (optionsWrapRef && !optionsWrapRef.contains(e.target as Node,)) {
                setShowOptionsMenu(false,);
            }
        };
        // Defer so the click that opened the menu doesn't immediately close it.
        document.addEventListener('pointerdown', onDocPointerDown,);
        onCleanup(() => document.removeEventListener('pointerdown', onDocPointerDown,),);
    },);

    onCleanup(cancelHoverClose,);

    // BlockEditor's reconcile-backed store keeps each block's identity
    // stable across data updates. `<For>` therefore preserves this row
    // through reorders too — no need to reset transient signals on
    // block.id changes the way the old <Index> path required.

    const childBlocks = () =>
        props.allBlocks.filter(b => b.parentBlockId === props.block.id)
            .sort((a, b,) => a.sort_order - b.sort_order,);

    return (
        <div
            id={props.block.id}
            data-block-id={props.block.id}
            data-parent-id={props.block.parentBlockId ?? ''}
            class={`content-block content-block--preview content-block--${props.block.type} ${
                props.isSelected ? 'content-block--selected' : ''
            } ${props.isDragging ? 'content-block--dragging' : ''} ${
                isDisabled() ? 'content-block--disabled' : ''
            } ${isCollapsed() ? 'content-block--collapsed' : ''}`}
            onClick={(e,) => {
                const tgt = e.target as HTMLElement;
                if (tgt.closest('button, .content-block__hover-drag, .content-block__options-menu, .add-block-dropdown',)) return;
                // Inline editors (HTML / Rich Text) own their own focus
                // semantics — clicks inside should select the block (so
                // the settings panel opens) but never deselect it. The
                // user moves out of edit mode by clicking the block's
                // hover bar, another block, or outside.
                const insideInlineEditor = tgt.closest(
                    '.html-inline-editor, .rich-text-inline-editor, .rich-text-editor',
                );
                if (insideInlineEditor) {
                    if (!props.isSelected) props.onToggleEdit(props.block.id,);
                    return;
                }
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
                    <Show when={isCollapsed()}>
                        <span class="content-block__hover-tag"> (Collapsed)</span>
                    </Show>
                    <Show when={isDisabled()}>
                        <span class="content-block__hover-tag"> (Disabled)</span>
                    </Show>
                </span>
                <button
                    class="content-block__hover-btn content-block__hover-btn--collapse"
                    onClick={() => setIsCollapsed(!isCollapsed(),)}
                    title={isCollapsed() ? 'Expand block' : 'Collapse block'}
                    aria-label={isCollapsed() ? 'Expand block' : 'Collapse block'}
                >
                    {isCollapsed() ? '+' : '–'}
                </button>
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
                <div
                    class="content-block__options-wrap"
                    ref={optionsWrapRef}
                    onMouseEnter={cancelHoverClose}
                    onMouseLeave={() => { if (showOptionsMenu()) scheduleHoverClose(); }}
                >
                    <button
                        class="content-block__hover-btn content-block__hover-btn--options"
                        onClick={() => setShowOptionsMenu(!showOptionsMenu(),)}
                        title="Options"
                    >
                        &#8943;
                    </button>
                    <button
                        class="content-block__hover-btn content-block__hover-btn--delete"
                        onClick={() => setShowRemoveConfirm(true,)}
                        title="Delete block"
                        aria-label="Delete block"
                    >
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path
                                d="M5 2V1h6v1h3v2H2V2h3zm1 2h4v9H6V4zm-2 0h1v9H4V4zm7 0h1v9h-1V4z"
                                fill="currentColor"
                            />
                        </svg>
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
                            <button onClick={() => { props.onInsertBefore?.(props.block.id,); setShowOptionsMenu(false,); }}>
                                Insert Block Before
                            </button>
                            <button onClick={() => { toggleDisabled(); setShowOptionsMenu(false,); }}>
                                {isDisabled() ? 'Enable' : 'Disable'}
                            </button>
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

            {/* Block preview — hidden when collapsed. */}
            <Show when={!isCollapsed()}>
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
                    <Match when={props.block.type === 'html' && props.isSelected}>
                        <HtmlInlineEditor
                            blockId={props.block.id}
                            content={props.block.data.content || ''}
                            onChange={(next,) => props.onUpdate(props.block.id, {
                                ...props.block.data,
                                content: next,
                            },)}
                        />
                    </Match>
                    <Match when={(props.block.type === 'rich_text' || props.block.type === 'text') && props.isSelected}>
                        <div class="rich-text-inline-editor">
                            <RichTextEditor
                                value={props.block.data.content || ''}
                                onChange={(next,) => props.onUpdate(props.block.id, {
                                    ...props.block.data,
                                    content: next,
                                },)}
                                placeholder="Type your content here…"
                            />
                        </div>
                    </Match>
                    <Match when={true}>
                        <BlockPreview block={props.block} />
                    </Match>
                </Switch>
            </div>
            </Show>

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
    // Shared with the public renderer so the preview matches the live output;
    // the editor adds a visible default gap + a min-height floor for slots.
    const containerStyle = () => groupContainerStyle(data(), { defaultGap: '12px', minHeight: '60px', },);

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
                        onInsertBefore={props.ownProps.onInsertBefore}
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
                                onSelect={(type, initialData,) =>
                                    props.ownProps.onAddChildBlock!(type, props.block.id, initialData,)}
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
