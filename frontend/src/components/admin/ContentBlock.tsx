import { Component, createEffect, createSignal, For, Match, onMount, Show, Switch, } from 'solid-js';
import MediaSelectModal from './MediaSelectModal';
import MediaUploadModal from './MediaUploadModal';
import { BlockStyleData, BlockStyleService, } from '../../services/blockStyles';
import CampaignBlock from './blocks/CampaignBlock';
import DocumentBlock from './blocks/DocumentBlock';
import FormBlock from './blocks/FormBlock';
import ImageBlock from './blocks/ImageBlock';
import SocialMediaBlock from './blocks/SocialMediaBlock';
import TextBlock from './blocks/TextBlock';
import UrlLinkBlock from './blocks/UrlLinkBlock';
import VideoBlock from './blocks/VideoBlock';
import BlockStyleEditor from './BlockStyleEditor';
import ConfirmModal from './ConfirmModal';

export type BlockType =
    // Post block types
    | 'text'
    | 'social_media'
    | 'image'
    | 'video'
    | 'document'
    | 'url_link'
    // Page block types
    | 'rich_text'
    | 'hero'
    | 'html'
    | 'campaign'
    | 'form'
    | 'post'
    | 'social_feed'
    | 'gallery';

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
    isEditing: boolean;
    isDragging: boolean;
    collapsed?: boolean;
    onToggleEdit: (id: string,) => void;
    onCancel: (id: string,) => void;
    onUpdate: (id: string, data: Record<string, any>,) => void;
    onRemove: (id: string,) => void;
    onMoveUp: (id: string,) => void;
    onMoveDown: (id: string,) => void;
    onDragStart: (e: PointerEvent, id: string,) => void;
    onToggleCollapse?: (id: string,) => void;
}

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
    text: 'Text',
    social_media: 'Social Media',
    image: 'Image',
    video: 'Video',
    document: 'Document',
    url_link: 'URL Link',
    rich_text: 'Rich Text',
    hero: 'Hero Banner',
    html: 'Custom HTML',
    campaign: 'Campaign',
    form: 'Form',
    post: 'Post Embed',
    social_feed: 'Social Feed',
    gallery: 'Gallery',
};

/** Simple key-value editor for reference-type blocks */
const ReferenceBlock: Component<
    {
        data: Record<string, any>;
        mode: string;
        onUpdate: (data: Record<string, any>,) => void;
        label: string;
        idField: string;
    }
> = (props,) => {
    return (
        <div class="block-reference">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-reference__preview">
                        <Show
                            when={props.data[props.idField]}
                            fallback={
                                <span class="block-text__empty">
                                    No {props.label.toLowerCase()} selected. Click Edit to configure.
                                </span>
                            }
                        >
                            <span>
                                {props.label} ID: <strong>{props.data[props.idField]}</strong>
                            </span>
                        </Show>
                        <Show when={props.data.title}>
                            <span>- {props.data.title}</span>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>{props.label} ID or Slug</label>
                    <input
                        type="text"
                        value={props.data[props.idField] || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, [props.idField]: e.currentTarget.value, },)}
                        placeholder={`Enter ${props.label.toLowerCase()} ID or slug...`}
                    />
                </div>
                <div class="form-group">
                    <label>Title (optional)</label>
                    <input
                        type="text"
                        value={props.data.title || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, title: e.currentTarget.value, },)}
                        placeholder="Display title..."
                    />
                </div>
            </Show>
        </div>
    );
};

/** Hero block */
const HeroBlock: Component<
    { data: Record<string, any>; mode: string; onUpdate: (data: Record<string, any>,) => void; }
> = (props,) => {
    const [showMediaSelect, setShowMediaSelect,] = createSignal(false,);
    const [showMediaUpload, setShowMediaUpload,] = createSignal(false,);

    const bgStyle = () => {
        if (!props.data.backgroundImage) return {};
        return {
            'background-image': `url(${props.data.backgroundImage})`,
            'background-size': props.data.backgroundSize || 'cover',
            'background-position': 'center',
            'background-repeat': 'no-repeat',
        };
    };

    return (
        <div class="block-hero">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div
                        class="block-hero__preview"
                        style={{
                            ...bgStyle(),
                            'text-align': 'center',
                            'padding': '2rem 1rem',
                            'border-radius': '4px',
                            'min-height': props.data.minHeight || (props.data.backgroundImage ? '150px' : undefined),
                            ...(props.data.backgroundImage ? {
                                'display': 'flex',
                                'flex-direction': 'column',
                                'align-items': 'center',
                                'justify-content': 'center',
                            } : {}),
                        }}
                    >
                        <Show
                            when={props.data.title || props.data.content || props.data.backgroundImage}
                            fallback={
                                <span class="block-text__empty">No hero content yet. Click Edit to configure.</span>
                            }
                        >
                            <Show when={props.data.title}>
                                <h2 style={{ 'margin-bottom': '0.25rem', }}>{props.data.title}</h2>
                            </Show>
                            <Show when={props.data.subtitle}>
                                <p style={{ color: '#6b7280', 'font-size': '1.25rem', 'margin-bottom': '0.5rem', }}>{props.data.subtitle}</p>
                            </Show>
                            <Show when={props.data.content}>
                                <div innerHTML={props.data.content} />
                            </Show>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Hero Title</label>
                    <input
                        type="text"
                        value={props.data.title || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, title: e.currentTarget.value, },)}
                        placeholder="Hero title..."
                    />
                </div>
                <div class="form-group">
                    <label>Subtitle</label>
                    <input
                        type="text"
                        value={props.data.subtitle || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, subtitle: e.currentTarget.value, },)}
                        placeholder="Hero subtitle..."
                    />
                </div>
                <div class="form-group">
                    <label>Background Image</label>
                    <Show when={props.data.backgroundImage}>
                        <div style={{ 'margin-bottom': '0.5rem', }}>
                            <img
                                src={props.data.backgroundImage}
                                alt=""
                                style={{
                                    'max-height': '120px',
                                    'max-width': '100%',
                                    'object-fit': 'cover',
                                    'border-radius': '4px',
                                    border: '1px solid #ddd',
                                }}
                            />
                        </div>
                    </Show>
                    <div style={{ display: 'flex', gap: '0.5rem', 'flex-wrap': 'wrap', }}>
                        <button
                            type="button"
                            class="btn btn--secondary btn--small"
                            onClick={() => setShowMediaSelect(true,)}
                        >
                            Select Media
                        </button>
                        <button
                            type="button"
                            class="btn btn--outline btn--small"
                            onClick={() => setShowMediaUpload(true,)}
                        >
                            Upload New
                        </button>
                        <Show when={props.data.backgroundImage}>
                            <button
                                type="button"
                                class="btn btn--ghost btn--small"
                                onClick={() => props.onUpdate({ ...props.data, backgroundImage: '', },)}
                                style={{ color: '#dc3545', }}
                            >
                                Remove
                            </button>
                        </Show>
                    </div>
                </div>
                <Show when={props.data.backgroundImage}>
                    <div class="form-group">
                        <label>Background Size</label>
                        <select
                            value={props.data.backgroundSize || 'cover'}
                            onChange={(e,) => props.onUpdate({ ...props.data, backgroundSize: e.currentTarget.value, },)}
                        >
                            <option value="cover">Cover (fill, may crop)</option>
                            <option value="contain">Contain (fit inside)</option>
                            <option value="100% 100%">Stretch (fill exactly)</option>
                            <option value="auto">Auto (original size)</option>
                        </select>
                    </div>
                </Show>
                <div class="form-group">
                    <label>Min Height</label>
                    <input
                        type="text"
                        value={props.data.minHeight || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, minHeight: e.currentTarget.value, },)}
                        placeholder="e.g. 300px, 50vh, 20rem"
                        style={{ 'max-width': '200px', }}
                    />
                    <small class="form-help">Any valid CSS value (px, rem, %, vw, vh)</small>
                </div>
                <div class="form-group">
                    <label>Width Mode</label>
                    <select
                        value={props.data.heroWidth || 'full'}
                        onChange={(e,) => props.onUpdate({ ...props.data, heroWidth: e.currentTarget.value, },)}
                    >
                        <option value="full">Full width (edge to edge)</option>
                        <option value="page">Page width (with site gutter)</option>
                    </select>
                </div>
                <TextBlock data={props.data} mode={props.mode as 'view' | 'edit'} onUpdate={props.onUpdate} />
            </Show>

            <Show when={showMediaSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        props.onUpdate({ ...props.data, backgroundImage: media.url, },);
                        setShowMediaSelect(false,);
                    }}
                    onClose={() => setShowMediaSelect(false,)}
                />
            </Show>
            <Show when={showMediaUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => {
                        props.onUpdate({ ...props.data, backgroundImage: media.url, },);
                        setShowMediaUpload(false,);
                    }}
                    onClose={() => setShowMediaUpload(false,)}
                />
            </Show>
        </div>
    );
};

/** HTML block */
const HtmlBlock: Component<
    { data: Record<string, any>; mode: string; onUpdate: (data: Record<string, any>,) => void; }
> = (props,) => {
    return (
        <div class="block-html">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-html__preview">
                        <Show
                            when={props.data.content}
                            fallback={<span class="block-text__empty">No HTML content yet. Click Edit to add.</span>}
                        >
                            <div innerHTML={props.data.content} />
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Custom HTML</label>
                    <textarea
                        rows={10}
                        value={props.data.content || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, content: e.currentTarget.value, },)}
                        placeholder="Enter raw HTML..."
                        style={{ 'font-family': 'monospace', 'font-size': '0.9em', }}
                    />
                </div>
            </Show>
        </div>
    );
};

const ContentBlock: Component<ContentBlockProps> = (props,) => {
    const mode = () => props.isEditing ? 'edit' : 'view';

    const [blockStyles, setBlockStyles,] = createSignal<BlockStyleData[]>([],);
    const [editingStyle, setEditingStyle,] = createSignal(false,);
    const [previewing, setPreviewing,] = createSignal(false,);
    const [showRemoveConfirm, setShowRemoveConfirm,] = createSignal(false,);
    const [collapsed, setCollapsed,] = createSignal(props.collapsed ?? false,);

    // Sync with external collapsed prop (for Expand All / Collapse All)
    createEffect(() => {
        if (props.collapsed !== undefined) setCollapsed(props.collapsed,);
    },);

    const toggleCollapse = () => {
        const next = !collapsed();
        setCollapsed(next,);
        props.onToggleCollapse?.(props.block.id,);
    };

    // Auto-expand when entering edit or preview mode
    const expandAndEdit = () => {
        setCollapsed(false,);
        props.onToggleEdit(props.block.id,);
    };
    const expandAndPreview = () => {
        setCollapsed(false,);
        setPreviewing(!previewing(),);
    };
    const [selectedStyleId, setSelectedStyleId,] = createSignal<string>('custom',);
    const [currentStyle, setCurrentStyle,] = createSignal<BlockStyleData>(BlockStyleService.getDefault(),);
    const [styleBackup, setStyleBackup,] = createSignal<BlockStyleData | null>(null,);
    const [stylesLoaded, setStylesLoaded,] = createSignal(false,);

    /** Resolve the initial style from any available source on the block */
    function getInitialStyleRef(): BlockData['styleRef'] | undefined {
        // Explicit null __styleRef in data means the user chose "none"
        if (props.block.data && '__styleRef' in props.block.data && props.block.data.__styleRef === null) {
            return undefined;
        }
        // Check styleRef first, then data.__styleRef, then data.style (from API)
        if (props.block.styleRef) return props.block.styleRef;
        const dataRef = props.block.data?.__styleRef;
        if (dataRef) return dataRef;
        // Direct style object from API response (e.g. { id: "uuid", name: "Default", ... })
        const style = (props.block as any).style || props.block.data?.style;
        if (style?.id) return { templateId: style.id, };
        if (style && typeof style === 'object' && Object.keys(style,).length > 0) return { custom: style, };
        return undefined;
    }

    const refreshStyles = async () => {
        BlockStyleService.invalidateCache();
        const styles = await BlockStyleService.getAll();
        setBlockStyles(styles,);
        return styles;
    };

    onMount(async () => {
        const styles = await BlockStyleService.getAll();
        setBlockStyles(styles,);

        // Now resolve and apply initial style
        const ref = getInitialStyleRef();
        if (ref?.templateId) {
            const template = styles.find(s => s.id === ref.templateId);
            if (template) {
                setCurrentStyle(BlockStyleService.withDefaults(template,),);
                setSelectedStyleId(ref.templateId,);
            }
        } else if (ref?.custom) {
            setCurrentStyle(BlockStyleService.withDefaults(ref.custom as BlockStyleData,),);
            setSelectedStyleId('custom',);
        } else {
            // No style set — block inherits site global styles
            setCurrentStyle({},);
            setSelectedStyleId('none',);
        }
        setStylesLoaded(true,);
    },);

    const handleUpdate = (data: Record<string, any>,) => {
        props.onUpdate(props.block.id, data,);
    };

    const handleStyleDropdownChange = (value: string,) => {
        setSelectedStyleId(value,);
        if (value === 'none') {
            // Clear any style — block will inherit site global styles.
            // Set __styleRef explicitly to null so the save handler knows to clear the backend style column.
            setCurrentStyle({},);
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: null, },);
        } else if (value === 'custom') {
            const customStyle = BlockStyleService.withDefaults(
                (props.block.styleRef?.custom || props.block.data?.__styleRef?.custom || {}) as BlockStyleData,
            );
            setCurrentStyle(customStyle,);
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { custom: customStyle, }, },);
        } else {
            const template = blockStyles().find(s => s.id === value);
            if (template) {
                setCurrentStyle(BlockStyleService.withDefaults(template,),);
                props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: value, }, },);
            }
        }
    };

    const handleEditStyle = () => {
        setStyleBackup({ ...currentStyle(), },);
        setTemplateDirty(false,);
        setEditingStyle(true,);
    };

    // Tracks whether the user has made changes in the editor that haven't been saved to the template
    const [templateDirty, setTemplateDirty,] = createSignal(false,);

    /** Called by BlockStyleEditor onChange — updates state and flags dirty, but does NOT switch selection */
    const updateCurrentStyle = (style: BlockStyleData,) => {
        setCurrentStyle(style,);
        const backup = styleBackup();
        if (backup) {
            const fields = [
                'backgroundColor',
                'textColor',
                'textAlign',
                'verticalAlign',
                'fontSize',
                'width',
                'padding',
                'margin',
                'gap',
            ] as const;
            const modified = fields.some(f => (style as any)[f] !== (backup as any)[f]);
            setTemplateDirty(modified,);
        }
    };

    /** Save Style button in header: closes the style editor, persists current state */
    const handleSaveStyle = async () => {
        const style = currentStyle();

        // If editing an existing template and changes weren't saved to the template,
        // switch to a custom config for this block only.
        if (style.id && templateDirty()) {
            const { id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua, ...customProps } = style;
            const filled = BlockStyleService.withDefaults(customProps as BlockStyleData,);
            setCurrentStyle(filled,);
            setSelectedStyleId('custom',);
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { custom: filled, }, },);
        } else if (style.id) {
            // Still pointing to a template, no unsaved changes — keep template reference
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: style.id, }, },);
        } else {
            // No template id — save as custom
            const { id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua, ...customProps } = style;
            const filled = BlockStyleService.withDefaults(customProps as BlockStyleData,);
            setCurrentStyle(filled,);
            setSelectedStyleId('custom',);
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { custom: filled, }, },);
        }

        setEditingStyle(false,);
        setStyleBackup(null,);
        setTemplateDirty(false,);
        await refreshStyles();
    };

    const handleCancelStyle = () => {
        if (styleBackup()) {
            setCurrentStyle(styleBackup()!,);
            // Restore the original selection
            const backup = styleBackup()!;
            if (backup.id) {
                setSelectedStyleId(backup.id,);
                props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: backup.id, }, },);
            }
        }
        setEditingStyle(false,);
        setStyleBackup(null,);
        setTemplateDirty(false,);
    };

    /** Save Template button in editor: creates or updates a global template */
    const handleSaveTemplate = async (style: BlockStyleData,) => {
        let saved: BlockStyleData | null = null;
        if (style.id) {
            saved = await BlockStyleService.update(style.id, style,);
        } else {
            saved = await BlockStyleService.create(style,);
        }
        if (saved) {
            setCurrentStyle(saved,);
            setSelectedStyleId(saved.id || 'custom',);
            // Update backup so "Save Style" sees this as the new baseline (not modified)
            setStyleBackup({ ...saved, },);
            // Template is now saved — clear dirty flag
            setTemplateDirty(false,);
            // Point this block to the saved/created template
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: saved.id, }, },);
        }
        await refreshStyles();
    };

    /** Copy to New: clears template id so next Save Template creates a new one */
    const handleCopyTemplate = () => {
        const style = currentStyle();
        setCurrentStyle({ ...style, id: undefined, name: '', },);
        // Don't change selectedStyleId or block data yet — user still needs to Save Template
    };

    const VALIGN_MAP: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end', };

    const previewStyles = () => {
        const s = currentStyle();
        const vAlign = s.verticalAlign && s.verticalAlign !== 'top' ? VALIGN_MAP[s.verticalAlign] : undefined;
        return {
            'background-color': s.backgroundColor || undefined,
            'color': s.textColor || undefined,
            'text-align': s.textAlign || undefined,
            'display': vAlign ? 'flex' : undefined,
            'flex-direction': vAlign ? 'column' : undefined,
            'justify-content': vAlign || undefined,
            'font-size': s.fontSize || undefined,
            'width': s.width || undefined,
            'padding': s.padding || undefined,
            'margin': s.margin || undefined,
            'gap': s.gap || undefined,
        };
    };

    return (
        <div
            class={`content-block ${props.isEditing ? 'content-block--editing' : ''} ${
                props.isDragging ? 'content-block--dragging' : ''
            } ${collapsed() ? 'content-block--collapsed' : ''}`}
            onPointerDown={(e,) => {
                if ((e.target as HTMLElement).closest('.block-toolbar__drag',)) {
                    props.onDragStart(e, props.block.id,);
                }
            }}
        >
            <div
                class="block-toolbar"
                onClick={(e,) => {
                    // Toggle collapse when clicking the header area (not buttons, selects, or drag handle)
                    const target = e.target as HTMLElement;
                    if (
                        target.closest('button',) || target.closest('select',) ||
                        target.closest('.block-toolbar__drag',) || target.closest('.block-toolbar__style',)
                    ) return;
                    toggleCollapse();
                }}
                style={{ cursor: 'pointer', }}
            >
                <span class="block-toolbar__drag" title="Drag to reorder">&#9776;</span>
                <span class="block-toolbar__type">
                    <span class="block-toolbar__collapse-icon">{collapsed() ? '\u25B6' : '\u25BC'}</span>
                    {BLOCK_TYPE_LABELS[props.block.type] || props.block.type}
                </span>

                {/* Style dropdown — always visible */}
                <div class="block-toolbar__style">
                    <span class="block-toolbar__style-label">STYLE</span>
                    <select
                        class="block-toolbar__style-select"
                        value={selectedStyleId()}
                        onChange={(e,) => handleStyleDropdownChange(e.currentTarget.value,)}
                        disabled={!props.isEditing}
                    >
                        <option value="none">None (inherit global)</option>
                        <option value="custom">Custom...</option>
                        <For each={blockStyles().sort((a, b,) => (a.name || '').localeCompare(b.name || '',))}>
                            {(style,) => (
                                <option value={style.id}>
                                    {style.name || 'Unnamed'}
                                    {style.isDefault ? ' (default)' : ''}
                                </option>
                            )}
                        </For>
                    </select>
                    <Show when={props.isEditing}>
                        <Show
                            when={!editingStyle()}
                            fallback={
                                <>
                                    <button class="btn btn--small btn--primary" onClick={handleSaveStyle}>
                                        Save Style
                                    </button>
                                    <button class="btn btn--small btn--ghost" onClick={handleCancelStyle}>
                                        Cancel
                                    </button>
                                </>
                            }
                        >
                            <button class="btn btn--small btn--link" onClick={handleEditStyle}>Edit Style</button>
                        </Show>
                    </Show>
                </div>

                <div class="block-toolbar__actions">
                    <button
                        class="btn btn--small btn--icon"
                        onClick={() => props.onMoveUp(props.block.id,)}
                        disabled={props.index === 0}
                        title="Move up"
                    >
                        &#9650;
                    </button>
                    <button
                        class="btn btn--small btn--icon"
                        onClick={() => props.onMoveDown(props.block.id,)}
                        disabled={props.index === props.total - 1}
                        title="Move down"
                    >
                        &#9660;
                    </button>
                    <Show when={!editingStyle()}>
                        <button class="btn btn--small btn--ghost" onClick={expandAndPreview}>
                            {previewing() ? 'Back' : 'Preview'}
                        </button>
                    </Show>
                    <button class="btn btn--small btn--secondary" onClick={expandAndEdit}>
                        {props.isEditing ? 'Save' : 'Edit'}
                    </button>
                    <Show when={props.isEditing}>
                        <button
                            class="btn btn--small btn--ghost"
                            onClick={() => {
                                props.onCancel(props.block.id,);
                                setEditingStyle(false,);
                                setPreviewing(false,);
                            }}
                        >
                            Cancel
                        </button>
                    </Show>
                    <button
                        class="btn btn--small btn--danger"
                        onClick={() => setShowRemoveConfirm(true,)}
                        title="Remove block"
                    >
                        &#10005;
                    </button>
                </div>
            </div>
            <div class={`content-block__body ${collapsed() ? 'content-block__body--collapsed' : ''}`}>
                <Show when={editingStyle()}>
                    <BlockStyleEditor
                        style={currentStyle()}
                        onChange={updateCurrentStyle}
                        allowSaveTemplate={true}
                        onSaveTemplate={handleSaveTemplate}
                        onCopyTemplate={currentStyle().id ? handleCopyTemplate : undefined}
                        onSetDefault={async (templateId,) => {
                            // Only set the isDefault flag, don't update any style properties
                            await BlockStyleService.update(templateId, { isDefault: true, },);
                            await refreshStyles();
                            // Update current style to reflect new default status
                            const updated = blockStyles().find(s => s.id === templateId);
                            if (updated) setCurrentStyle(BlockStyleService.withDefaults(updated,),);
                        }}
                    />
                </Show>
                <Show when={previewing() && !editingStyle()}>
                    <div class="content-block__preview" style={previewStyles()}>
                        <BlockContent block={props.block} mode="view" onUpdate={handleUpdate} />
                    </div>
                </Show>
                <Show when={!editingStyle() && !previewing()}>
                    <BlockContent block={props.block} mode={mode()} onUpdate={handleUpdate} />
                </Show>
            </div>
            <ConfirmModal
                open={showRemoveConfirm()}
                title="Remove Block"
                message="Are you sure you want to remove this content block? This action cannot be undone."
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

/** Extracted block content renderer */
const BlockContent: Component<
    { block: BlockData; mode: string; onUpdate: (data: Record<string, any>,) => void; }
> = (props,) => {
    return (
        <Switch>
            <Match when={props.block.type === 'text'}>
                <TextBlock data={props.block.data} mode={props.mode as 'view' | 'edit'} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'social_media'}>
                <SocialMediaBlock data={props.block.data} mode={props.mode as any} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'image'}>
                <ImageBlock data={props.block.data} mode={props.mode as any} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'video'}>
                <VideoBlock data={props.block.data} mode={props.mode as any} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'document'}>
                <DocumentBlock data={props.block.data} mode={props.mode as any} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'url_link'}>
                <UrlLinkBlock data={props.block.data} mode={props.mode as any} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'rich_text'}>
                <TextBlock data={props.block.data} mode={props.mode as 'view' | 'edit'} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'hero'}>
                <HeroBlock data={props.block.data} mode={props.mode} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'html'}>
                <HtmlBlock data={props.block.data} mode={props.mode} onUpdate={props.onUpdate} />
            </Match>
            <Match when={props.block.type === 'campaign'}>
                <CampaignBlock
                    data={props.block.data}
                    mode={props.mode}
                    onUpdate={props.onUpdate}
                />
            </Match>
            <Match when={props.block.type === 'form'}>
                <FormBlock
                    data={props.block.data}
                    mode={props.mode}
                    onUpdate={props.onUpdate}
                />
            </Match>
            <Match when={props.block.type === 'post'}>
                <ReferenceBlock
                    data={props.block.data}
                    mode={props.mode}
                    onUpdate={props.onUpdate}
                    label="Post"
                    idField="postId"
                />
            </Match>
            <Match when={props.block.type === 'social_feed'}>
                <ReferenceBlock
                    data={props.block.data}
                    mode={props.mode}
                    onUpdate={props.onUpdate}
                    label="Social Feed"
                    idField="platform"
                />
            </Match>
            <Match when={props.block.type === 'gallery'}>
                <ReferenceBlock
                    data={props.block.data}
                    mode={props.mode}
                    onUpdate={props.onUpdate}
                    label="Gallery"
                    idField="galleryId"
                />
            </Match>
        </Switch>
    );
};

export default ContentBlock;
