import { batch, Component, createSignal, ErrorBoundary, For, onCleanup, onMount, Show, untrack, } from 'solid-js';
import { Dynamic, } from 'solid-js/web';
import { BlockStyleData, BlockStyleService, } from '../../../services/blockStyles';
import { clearStyleDraft, setStyleDraft, } from '../../../stores/blockStyleDraft';
import { holdViewport, } from './viewportHold';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import TemplateReference from './TemplateReference';
import type { BlockData, BlockType, } from './ContentBlock';
import BlockStyleEditor from './blockStyles/BlockStyleEditor';
import { useAppearance, } from '../../../hooks/useAppearance';
import CampaignBlock from './types/CampaignBlock';
import CarouselBlock from './types/CarouselBlock';
import EntityBlockEdit from './types/EntityBlock';
import EventsBlockEdit from './types/EventsBlockEdit';
import ForumBlockEdit from './types/ForumBlockEdit';
import GalleryBlockEdit from './types/GalleryBlockEdit';
import TemplateBlockEdit from './types/TemplateBlock';
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
import HeroBlockEdit from './types/HeroBlock';
import { CommitInput, } from '../forms/CommitInput';
import { useToast, } from '../../common/toast';

// Inline simple block editors for types that don't have separate files

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
    <FormField label={`${props.label} ID or Slug`}>
        <input type="text" value={props.data[props.idField] || ''} onChange={(e,) => props.onUpdate({ ...props.data, [props.idField]: e.currentTarget.value, },)} placeholder={`Enter ${props.label.toLowerCase()} ID...`} />
    </FormField>
);

const SpacerBlockEdit: Component<{ data: Record<string, any>; onUpdate: (d: Record<string, any>,) => void; }> = (props,) => (
    <FormField label="Height" hint="Any valid CSS height: px, rem, em, vh, vw, %. A bare number is px. Empty = 60px.">
        <CommitInput
            value={props.data.height}
            onCommit={(v,) => props.onUpdate({ ...props.data, height: v, },)}
            placeholder="60px"
        />
    </FormField>
);

/** Block types whose text accepts `{{ }}`, with the field(s) it applies to. */
const TEMPLATABLE_TYPES: ReadonlyMap<string, string> = new Map([
    ['rich_text', '{{ }} works in the text of this block.',],
    ['text', '{{ }} works in the text of this block.',],
    ['html', '{{ }} works in the HTML of this block.',],
    ['hero', '{{ }} works in the title, subtitle and content.',],
    ['url_link', '{{ }} works in the title, description and URL.',],
    ['entity', "{{ }} works in the template's text blocks, with the bound record's variables.",],
    ['template', "{{ }} works in the component's text blocks.",],
],);

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
    // Site-defined responsive breakpoints → the style editor's breakpoint picker.
    const appearance = useAppearance();
    const [blockStyles, setBlockStyles,] = createSignal<BlockStyleData[]>([],);
    const [currentStyle, setCurrentStyle,] = createSignal<BlockStyleData>(BlockStyleService.getDefault(),);
    const [selectedStyleId, setSelectedStyleId,] = createSignal<string>('none',);
    const [showRemoveConfirm, setShowRemoveConfirm,] = createSignal(false,);
    const [showTplRef, setShowTplRef,] = createSignal(false,);
    const toast = useToast();

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

    // Style edits still do NOT write to the block while editing — `onUpdate`
    // replaces the block's data, re-rendering this whole controller and
    // stealing focus from the input being typed in.
    //
    // They are instead published to a side channel (`stores/blockStyleDraft`)
    // that only `BlockPreview` reads, so the preview tracks the controls live
    // while the block tree — and therefore this panel — stays untouched.
    // Without it, choosing a padding or a colour was guesswork until Save.
    // The panel is mounted per block id (keyed by BlockEditor), so the id is
    // fixed for this controller's life. Captured once so teardown never reads
    // `props.block` — a cleanup that throws aborts Solid's disposal and leaves
    // the whole editor unresponsive.
    const blockId = untrack(() => props.block.id,);

    const publishDraft = (style: BlockStyleData,) => {
        holdViewport(blockId,);
        setCurrentStyle(style,);
        setStyleDraft(blockId, style as unknown as Record<string, unknown>,);
    };

    // Stop previewing: Save has already committed the value to the block, and
    // for Cancel, dropping the draft IS the revert (the preview falls back to
    // the block's saved style).
    const stopDraft = () => clearStyleDraft(blockId,);

    // A block unmounted mid-edit (deleted, or the editor navigated away) must
    // not leave its draft behind — a later block reusing the id would inherit
    // someone else's in-progress style.
    onCleanup(() => clearStyleDraft(blockId,));

    /** The style's own properties — without the template identity fields. */
    const styleProps = (style: BlockStyleData,): Record<string, unknown> => {
        const { id: _id, name: _name, isDefault: _d, ...rest } = style as BlockStyleData & Record<string, unknown>;
        delete rest.createdAt;
        delete rest.updatedAt;
        return rest;
    };

    /** True when the edited values differ from the template they started from. */
    const differsFromTemplate = (style: BlockStyleData,): boolean => {
        const tmpl = blockStyles().find((s,) => s.id === style.id);
        if (!tmpl) return false;
        const norm = (o: Record<string, unknown>,) =>
            JSON.stringify(Object.fromEntries(
                Object.entries(o,).filter(([, v,],) => v !== undefined && v !== null && v !== '').sort(([a,], [b,],) => a.localeCompare(b,)),
            ),);
        return norm(styleProps(BlockStyleService.withDefaults(tmpl,),),) !== norm(styleProps(style,),);
    };

    const handleSaveStyle = () => {
        holdViewport(blockId,);
        const style = currentStyle();
        if (style.id && !differsFromTemplate(style,)) {
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { templateId: style.id, }, },);
        } else {
            // Custom style — OR a template whose values were edited here. Save
            // used to keep only the template link and silently DROP the edits
            // (clearing a template's Max Height did nothing), so the block now
            // gets its own copy of the edited values. Changing the template for
            // every block that uses it stays the job of Save Template.
            if (style.id) {
                setCurrentStyle({ ...style, id: undefined, name: '', isDefault: false, },);
                setSelectedStyleId('custom',);
            }
            props.onUpdate(props.block.id, { ...props.block.data, __styleRef: { custom: styleProps(style,), }, },);
        }
        stopDraft();
        setEditingStyle(false,);
    };

    const handleSaveTemplate = async (style: BlockStyleData,) => {
        let saved: BlockStyleData | null = null;
        try {
            saved = style.id ? await BlockStyleService.update(style.id, style,) : await BlockStyleService.create(style,);
        } catch (e) {
            toast.error(`Could not save the style template: ${(e as Error).message || 'unknown error'}`,);
            return;
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
                        <button type="button" class="ui-button ui-button--sm ui-button--ghost bec-dirty-bar__revert" onClick={() => setShowRevertConfirm(true,)}>
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
                            type="button"
                            class="bec-icon-btn bec-icon-btn--danger"
                            onClick={() => setShowRemoveConfirm(true,)}
                            title="Delete block"
                            aria-label="Delete block"
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
                            type="button"
                            class="bec-icon-btn"
                            aria-label="Edit style"
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
                        <button type="button" class="ui-button ui-button--sm ui-button--primary" onClick={handleSaveStyle}>Save</button>
                        <button type="button" class="ui-button ui-button--sm ui-button--ghost" onClick={() => { stopDraft(); setEditingStyle(false,); }}>Cancel</button>
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
                        onChange={publishDraft}
                        breakpoints={appearance()?.breakpoints ?? []}
                        allowSaveTemplate={true}
                        onSaveTemplate={handleSaveTemplate}
                        onCopyTemplate={currentStyle().id ? (() => {
                            setCurrentStyle({ ...currentStyle(), id: undefined, name: '', },);
                        }) : undefined}
                        onSetDefault={async (templateId,) => {
                            try {
                                await BlockStyleService.update(templateId, { isDefault: true, },);
                            } catch (e) {
                                toast.error(`Could not set the default style: ${(e as Error).message || 'unknown error'}`,);
                                return;
                            }
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

            {/* ── Variable & Function Reference (collapsible, bottom of panel) —
                only for block types whose text takes {{ }} ── */}
            <Show when={TEMPLATABLE_TYPES.has(props.block.type,)}>
            <div class="block-edit-controller__tpl-ref">
                <button
                    type="button"
                    class="block-edit-controller__tpl-ref-toggle"
                    onClick={() => setShowTplRef(!showTplRef(),)}
                    aria-expanded={showTplRef()}
                >
                    <span>{showTplRef() ? '▾' : '▸'}</span>
                    Variable &amp; Function Reference
                </button>
                <Show when={showTplRef()}>
                    <p class="form-help-muted">{TEMPLATABLE_TYPES.get(props.block.type,)}</p>
                    <TemplateReference />
                </Show>
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

type EditFormProps = { block: BlockData; onUpdate: (data: Record<string, any>,) => void; };

/** Shown for a type with no edit form here. */
const NoEditForm: Component<EditFormProps> = (p,) => (
    <p class="form-help-muted">The {p.block.type.replace(/_/g, ' ',)} block has no options here.</p>
);

/**
 * The edit form per block type. A `Record<BlockType, …>`, so adding a
 * `BlockType` fails to compile until it gets an arm (was a 20-arm <Switch>
 * that silently rendered nothing for a new type). `null` = no form here.
 */
const BLOCK_EDIT_FORMS: Record<BlockType, Component<EditFormProps> | null> = {
    rich_text: (p,) => <TextBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    text: (p,) => <TextBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    image: (p,) => <ImageBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    video: (p,) => <VideoBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    document: (p,) => <DocumentBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    url_link: (p,) => <UrlLinkBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    hero: (p,) => <HeroBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    html: (p,) => <HtmlBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    campaign: (p,) => <CampaignBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    form: (p,) => <FormBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    social: (p,) => <SocialBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    carousel: (p,) => <CarouselBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    post: (p,) => <ReferenceBlockEdit data={p.block.data} onUpdate={p.onUpdate} label="Post" idField="postId" />,
    post_list: (p,) => <PostListBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    gallery: (p,) => <GalleryBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    spacer: (p,) => <SpacerBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    group: (p,) => <GroupBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    group_item: (p,) => <GroupItemBlock data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    entity: (p,) => <EntityBlockEdit data={p.block.data} mode="edit" onUpdate={p.onUpdate} />,
    template: (p,) => (
        <TemplateBlockEdit
            settings={p.block.data as Record<string, unknown>}
            onChange={(patch,) => p.onUpdate({ ...p.block.data, ...patch, },)}
        />
    ),
    events: (p,) => <EventsBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    // Legacy name of `events` — same panel; the first edit folds `eventId` into `binding`.
    event: (p,) => <EventsBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
    forum: (p,) => <ForumBlockEdit data={p.block.data} onUpdate={p.onUpdate} />,
};

/**
 * Routes to the correct edit form based on block type.
 *
 * Wrapped in an ErrorBoundary: if a type's form throws while rendering (e.g.
 * settings it does not expect), Solid would otherwise leave the PREVIOUS
 * type's fields on screen with no sign of the failure — the "stuck" panel.
 * The boundary shows what failed instead, and resets when the type changes
 * (the panel is keyed on id + type).
 */
const BlockContentForm: Component<{
    block: BlockData;
    onUpdate: (data: Record<string, any>,) => void;
}> = (props,) => (
    <ErrorBoundary
        fallback={(err,) => {
            console.error('[BlockEditController] edit form failed', props.block.type, err,);
            return (
                <div class="alert alert--error">
                    The {props.block.type} options could not be shown: {err instanceof Error ? err.message : String(err,)}. Try
                    changing the block type again, or reload the page.
                </div>
            );
        }}
    >
    <Dynamic component={BLOCK_EDIT_FORMS[props.block.type as BlockType] ?? NoEditForm} block={props.block} onUpdate={props.onUpdate} />
    </ErrorBoundary>
);

export default BlockEditController;
