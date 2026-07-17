import { batch, Component, createSignal, For, Match, onMount, Show, Switch, } from 'solid-js';
import { BlockStyleData, BlockStyleService, } from '../../../services/blockStyles';
import Toggle from '../common/Toggle';
import type { BlockData, BlockType, } from './ContentBlock';
import BlockStyleEditor from './blockStyles/BlockStyleEditor';
import CampaignBlock from './types/CampaignBlock';
import CarouselBlock from './types/CarouselBlock';
import DocumentBlock from './types/DocumentBlock';
import FormBlock from './types/FormBlock';
import GroupBlock from './types/GroupBlock';
import GroupItemBlock from './types/GroupItemBlock';
import ImageBlock from './types/ImageBlock';
import PostListBlock from './types/PostListBlock';
import SocialBlock from './types/SocialBlock';
import TextBlock from './types/TextBlock';
import UrlLinkBlock from './types/UrlLinkBlock';
import VideoBlock from './types/VideoBlock';
import ConfirmModal from '../common/ConfirmModal';

// Inline simple block editors for types that don't have separate files
const HeroBlockEdit: Component<{ data: Record<string, any>; onUpdate: (d: Record<string, any>,) => void; }> = (props,) => {
    return (
        <>
            <div class="form-group">
                <label>Hero Title</label>
                <input type="text" value={props.data.title || ''} onInput={(e,) => props.onUpdate({ ...props.data, title: e.currentTarget.value, },)} placeholder="Hero title..." />
            </div>
            <div class="form-group">
                <label>Subtitle</label>
                <input type="text" value={props.data.subtitle || ''} onInput={(e,) => props.onUpdate({ ...props.data, subtitle: e.currentTarget.value, },)} placeholder="Subtitle..." />
            </div>
            <div class="form-group">
                <label>Content</label>
                <textarea rows={4} value={props.data.content || ''} onInput={(e,) => props.onUpdate({ ...props.data, content: e.currentTarget.value, },)} placeholder="Hero content (HTML)..." />
            </div>
            <div class="form-group">
                <label>Background Image URL</label>
                <input type="text" value={props.data.backgroundImage || ''} onInput={(e,) => props.onUpdate({ ...props.data, backgroundImage: e.currentTarget.value, },)} placeholder="https://..." />
            </div>
            <div class="form-group">
                <label>Min Height</label>
                <input type="text" value={props.data.minHeight || ''} onInput={(e,) => props.onUpdate({ ...props.data, minHeight: e.currentTarget.value, },)} placeholder="e.g. 300px, 50vh" />
            </div>
        </>
    );
};

/** HTML body content is edited inline on the block preview itself
 *  (HtmlInlineEditor) — the flyout panel only shows the general
 *  settings (block style, padding, etc.) for HTML blocks. */
const HtmlBlockEdit: Component<{ data: Record<string, any>; onUpdate: (d: Record<string, any>,) => void; }> = () => (
    <div class="form-group">
        <small class="form-help-muted">
            HTML content is edited directly on the block — click the block to switch between Code and Preview modes.
        </small>
    </div>
);

const ReferenceBlockEdit: Component<{
    data: Record<string, any>; onUpdate: (d: Record<string, any>,) => void;
    label: string; idField: string;
}> = (props,) => (
    <div class="form-group">
        <label>{props.label} ID or Slug</label>
        <input type="text" value={props.data[props.idField] || ''} onInput={(e,) => props.onUpdate({ ...props.data, [props.idField]: e.currentTarget.value, },)} placeholder={`Enter ${props.label.toLowerCase()} ID...`} />
    </div>
);

const SpacerBlockEdit: Component<{ data: Record<string, any>; onUpdate: (d: Record<string, any>,) => void; }> = (props,) => (
    <div class="form-group">
        <label>Height</label>
        <input
            type="text"
            value={props.data.height || '60px'}
            onInput={(e,) => props.onUpdate({ ...props.data, height: e.currentTarget.value, },)}
            placeholder="e.g. 60px, 2rem, 10vh"
        />
        <small class="form-help">Any valid CSS height: px, rem, em, vh, vw, %</small>
    </div>
);

// ─── Main controller ───

export interface BlockEditControllerProps {
    block: BlockData;
    blockTypes?: Array<{ type: BlockType; label: string; }>;
    onUpdate: (id: string, data: Record<string, any>,) => void;
    onChangeType?: (id: string, newType: BlockType,) => void;
    onRemove: (id: string,) => void;
    onClose: () => void;
    isDirty?: boolean;
    onRevert?: () => void;
}

// Block-type labels live in config/blockTypes.ts. Use getBlockLabel(type)
// from there if you need them here.

const BlockEditController: Component<BlockEditControllerProps> = (props,) => {
    const [editingStyle, setEditingStyle,] = createSignal(false,);
    const [blockStyles, setBlockStyles,] = createSignal<BlockStyleData[]>([],);
    const [currentStyle, setCurrentStyle,] = createSignal<BlockStyleData>(BlockStyleService.getDefault(),);
    const [selectedStyleId, setSelectedStyleId,] = createSignal<string>('none',);
    const [showRemoveConfirm, setShowRemoveConfirm,] = createSignal(false,);

    // Load styles once on mount — NOT reactive on props.block changes,
    // so style changes don't re-resolve and cause scroll jumps or resets.
    onMount(async () => {
        const styles = await BlockStyleService.getAll();
        setBlockStyles(styles,);

        const ref = props.block.data?.__styleRef || props.block.styleRef;
        if (ref?.templateId) {
            const tmpl = styles.find(s => s.id === ref.templateId);
            if (tmpl) {
                setCurrentStyle(BlockStyleService.withDefaults(tmpl,),);
                setSelectedStyleId(tmpl.id!,);
                return;
            }
        }
        if (ref?.custom) {
            setCurrentStyle(BlockStyleService.withDefaults(ref.custom as BlockStyleData,),);
            setSelectedStyleId('custom',);
            return;
        }
        setSelectedStyleId('none',);
        setCurrentStyle(BlockStyleService.getDefault(),);
    },);

    const handleUpdate = (data: Record<string, any>,) => {
        props.onUpdate(props.block.id, data,);
    };

    const handleStyleChange = (styleId: string,) => {
        setSelectedStyleId(styleId,);
        if (styleId === 'none') {
            setCurrentStyle(BlockStyleService.getDefault(),);
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: null, },);
        } else if (styleId === 'custom') {
            setCurrentStyle(BlockStyleService.getDefault(),);
            setEditingStyle(true,);
        } else {
            const tmpl = blockStyles().find(s => s.id === styleId);
            if (tmpl) {
                setCurrentStyle(BlockStyleService.withDefaults(tmpl,),);
                props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: tmpl.id, }, },);
            }
        }
    };

    // Style edits update only the local `currentStyle` while editing — the
    // block (and thus its preview + saved output) is NOT touched until the
    // operator clicks Save in the style panel (`handleSaveStyle`). This keeps
    // the inputs from re-rendering the preview mid-edit, which stole focus /
    // scrolled the page.

    const handleSaveStyle = () => {
        const style = currentStyle();
        if (style.id) {
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: style.id, }, },);
        } else {
            const { id: _id, name: _name, isDefault: _d, ...customProps } = style;
            delete (customProps as any).createdAt;
            delete (customProps as any).updatedAt;
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { custom: customProps, }, },);
        }
        setEditingStyle(false,);
    };

    const handleSaveTemplate = async (style: BlockStyleData,) => {
        let saved: BlockStyleData | null = null;
        if (style.id) {
            saved = await BlockStyleService.update(style.id, style,);
        } else {
            saved = await BlockStyleService.create(style,);
        }
        if (saved) {
            // Refresh the styles list so the new/updated template
            // is available in the dropdown before we select it.
            BlockStyleService.invalidateCache();
            const updatedStyles = await BlockStyleService.getAll();
            const savedId = saved.id!;
            // Snapshot block data before reactive updates
            const blockData = { ...props.block.data, };

            // Force selectedStyleId to change so SolidJS re-applies it
            // after <For> rebuilds <option> elements (same value = no-op).
            setSelectedStyleId('',);
            batch(() => {
                setBlockStyles(updatedStyles,);
                setCurrentStyle(BlockStyleService.withDefaults(saved!,),);
                setSelectedStyleId(savedId,);
            },);

            // Point the block to this template
            props.onUpdate(props.block.id, { ...blockData, __styleRef: { templateId: savedId, }, },);
        }
    };

    const [showRevertConfirm, setShowRevertConfirm,] = createSignal(false,);

    return (
        <div class="block-edit-controller">
            {/* ─── Unsaved changes bar ─── */}
            <Show when={props.isDirty}>
                <div class="bec-dirty-bar">
                    <span class="bec-dirty-bar__label">Unsaved changes</span>
                    <Show when={props.onRevert}>
                        <button class="btn btn--xs btn--ghost bec-dirty-bar__revert" onClick={() => setShowRevertConfirm(true,)}>
                            Revert
                        </button>
                    </Show>
                </div>
                <ConfirmModal
                    open={showRevertConfirm()}
                    title="Revert Block"
                    message="Revert this block to its last saved state? All unsaved changes will be lost."
                    confirmLabel="Revert"
                    onConfirm={() => {
                        setShowRevertConfirm(false,);
                        props.onRevert?.();
                    }}
                    onCancel={() => setShowRevertConfirm(false,)}
                    danger={true}
                />
            </Show>

            {/* ─── Block type ─── */}
            <div class="bec-field">
                <Show when={props.blockTypes && props.onChangeType}>
                    <label class="bec-field__label">Type</label>
                    <div class="bec-field__row">
                        <select
                            class="bec-field__input"
                            value={props.block.type}
                            onChange={(e,) => {
                                const newType = e.currentTarget.value as BlockType;
                                if (newType !== props.block.type) {
                                    props.onChangeType!(props.block.id, newType,);
                                }
                            }}
                        >
                            <For each={props.blockTypes!}>
                                {(bt,) => <option value={bt.type}>{bt.label}</option>}
                            </For>
                        </select>
                        <button
                            class="bec-icon-btn bec-icon-btn--danger"
                            onClick={() => setShowRemoveConfirm(true,)}
                            title="Delete block"
                        >
                            <svg viewBox="0 0 16 16" width="16" height="16">
                                <path d="M5 2V1h6v1h3v2H2V2h3zm1 2h4v9H6V4zm-2 0h1v9H4V4zm7 0h1v9h-1V4z" fill="currentColor" />
                            </svg>
                        </button>
                    </div>
                </Show>
            </div>

            {/* ─── Style selector ─── */}
            <div class="bec-field">
                <label class="bec-field__label">Style</label>
                <div class="bec-field__row">
                    <select
                        class="bec-field__input"
                        value={selectedStyleId()}
                        onChange={(e,) => handleStyleChange(e.currentTarget.value,)}
                    >
                        <option value="none">None (inherit global)</option>
                        <option value="custom">Custom...</option>
                        <For each={blockStyles().toSorted((a, b,) => (a.name || '').localeCompare(b.name || '',))}>
                            {(s,) => (
                                <option value={s.id}>
                                    {s.name || 'Unnamed'}{s.isDefault ? ' (default)' : ''}
                                </option>
                            )}
                        </For>
                    </select>
                    <Show when={!editingStyle()}>
                        <button
                            class="bec-icon-btn"
                            onClick={() => {
                                if (selectedStyleId() === 'none') {
                                    handleStyleChange('custom',);
                                } else {
                                    setEditingStyle(true,);
                                }
                            }}
                            title="Edit style"
                        >
                            <svg viewBox="0 0 16 16" width="16" height="16">
                                <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" fill="none" stroke-width="1.2" />
                            </svg>
                        </button>
                    </Show>
                    <Show when={editingStyle() && selectedStyleId() !== 'none'}>
                        <button class="btn btn--xs btn--primary" onClick={handleSaveStyle}>Save</button>
                        <button class="btn btn--xs btn--ghost" onClick={() => setEditingStyle(false,)}>Cancel</button>
                    </Show>
                </div>
            </div>

            {/* ─── Default padding toggle ─── */}
            <div class="bec-field">
                <Toggle
                    checked={props.block.data.useDefaultPadding !== false}
                    onChange={(next,) => {
                        handleUpdate({
                            ...props.block.data,
                            useDefaultPadding: next,
                        },);
                    }}
                    label="Use default block padding"
                />
            </div>

            {/* ─── Disable toggle (mirrors the block header menu) ─── */}
            <div class="bec-field">
                <Toggle
                    checked={Boolean(props.block.data.disabled)}
                    onChange={(next,) => {
                        handleUpdate({
                            ...props.block.data,
                            disabled: next,
                        },);
                    }}
                    label="Disable block"
                />
            </div>

            <div class="bec-divider" />

            {/* ─── Style editor or block form ─── */}
            <Show
                when={!editingStyle() || selectedStyleId() === 'none'}
                fallback={
                    <BlockStyleEditor
                        style={currentStyle()}
                        onChange={setCurrentStyle}
                        allowSaveTemplate={true}
                        onSaveTemplate={handleSaveTemplate}
                        onCopyTemplate={currentStyle().id ? (() => {
                            setCurrentStyle({ ...currentStyle(), id: undefined, name: '', },);
                        }) : undefined}
                        onSetDefault={async (templateId,) => {
                            await BlockStyleService.update(templateId, { isDefault: true, },);
                            setBlockStyles(await BlockStyleService.getAll(),);
                            const updated = blockStyles().find(s => s.id === templateId);
                            if (updated) setCurrentStyle(BlockStyleService.withDefaults(updated,),);
                        }}
                    />
                }
            >
                <div class="block-edit-controller__form">
                    <BlockContentForm
                        block={props.block}
                        onUpdate={handleUpdate}
                    />
                </div>
            </Show>

            <ConfirmModal
                open={showRemoveConfirm()}
                title="Delete Block"
                message="Are you sure you want to delete this content block?"
                confirmLabel="Delete"
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

/** Routes to the correct edit form based on block type */
const BlockContentForm: Component<{
    block: BlockData;
    onUpdate: (data: Record<string, any>,) => void;
}> = (props,) => (
    <Switch>
        <Match when={props.block.type === 'text' || props.block.type === 'rich_text'}>
            <TextBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'image'}>
            <ImageBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'video'}>
            <VideoBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'document'}>
            <DocumentBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'url_link'}>
            <UrlLinkBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'hero'}>
            <HeroBlockEdit data={props.block.data} onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'html'}>
            <HtmlBlockEdit data={props.block.data} onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'campaign'}>
            <CampaignBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'form'}>
            <FormBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'social'}>
            <SocialBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'carousel'}>
            <CarouselBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'post'}>
            <ReferenceBlockEdit data={props.block.data} onUpdate={props.onUpdate} label="Post" idField="postId" />
        </Match>
        <Match when={props.block.type === 'post_list'}>
            <PostListBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'gallery'}>
            <ReferenceBlockEdit data={props.block.data} onUpdate={props.onUpdate} label="Gallery" idField="galleryId" />
        </Match>
        <Match when={props.block.type === 'spacer'}>
            <SpacerBlockEdit data={props.block.data} onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'group'}>
            <GroupBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
        <Match when={props.block.type === 'group_item'}>
            <GroupItemBlock data={props.block.data} mode="edit" onUpdate={props.onUpdate} />
        </Match>
    </Switch>
);

export default BlockEditController;
