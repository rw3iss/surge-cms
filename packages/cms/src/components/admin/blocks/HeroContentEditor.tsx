import { viewMediaProps, } from '@/stores/mediaViewer';
import type {
    HeroCarouselOptions,
    HeroCarouselSettings,
    HeroItem,
    HeroPostsConfig,
} from '@sitesurge/types';
import type { AppearanceSettings, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createResource, createSignal, For, Match, onMount, Show, Switch, } from 'solid-js';
import { createStore, reconcile, } from 'solid-js/store';
import { cms, } from '../../../services/cmsClient';
import ResolvedHeroCarousel from '../../blocks/ResolvedHeroCarousel';
import { renderEntityTemplateSlide, } from '../../blocks/BlockRenderer';
import { useToast, } from '../../common/toast';
import MediaSelectModal from '../media/MediaSelectModal';
import MediaUploadModal from '../media/MediaUploadModal';
import PostQueryEditor from './PostQueryEditor';
import EntityBlockEdit from './types/EntityBlock';
import Toggle from '../common/Toggle';
import CarouselOptions from './carousel/CarouselOptions';
import { DEFAULT_OPTIONS, entitySummary, genId, OBJECT_FIT_OPTIONS, postsSummary, } from './carousel/heroItemUtils';
import { ActionSection, TextOverlaySection, } from './carousel/TextOverlayEditor';
import './HeroContentEditor.scss';

export interface HeroContentEditorProps {
    /** When provided, the editor operates in "block mode" — reads/writes
     *  data via these callbacks instead of the settings API. */
    initialData?: HeroCarouselSettings;
    /** Called on every change in block mode so the parent can persist. */
    onChange?: (data: HeroCarouselSettings,) => void;
    /** If true, hide the standalone Save button (parent handles save). */
    hideHeader?: boolean;
}

const HeroContentEditor: Component<HeroContentEditorProps> = (props,) => {
    const toast = useToast();
    const [items, setItems,] = createSignal<HeroItem[]>([],);
    // Mirror `items()` into a store keyed by `id` so editing ONE item merges into
    // its existing proxy instead of replacing it — the item CARDS iterate this
    // store, so a card (and its EntityBlockEdit panel + async selects) is never
    // torn down/remounted on an edit. Without this, `<For each={items()}>` keys
    // by reference and every edit recreates the row, which (a) resets the entity
    // type <select> (its options re-fetch after the value binds, so it can't
    // select) and (b) churns the DOM, jumping the page scroll.
    const [storeItems, setStoreItems,] = createStore<HeroItem[]>([],);
    createEffect(() => setStoreItems(reconcile(items(), { key: 'id', merge: true, },),),);
    const [options, setOptions,] = createSignal<HeroCarouselOptions>({ ...DEFAULT_OPTIONS, },);
    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(true,);

    const [appearance,] = createResource(async () => {
        try {
            return await cms.settings.getAppearance() as AppearanceSettings;
        } catch {
            return null;
        }
    },);

    const gutterWidth = () => appearance()?.gutterWidth || undefined;
    const [showMediaSelect, setShowMediaSelect,] = createSignal(false,);
    const [showMediaUpload, setShowMediaUpload,] = createSignal(false,);

    // Drag state
    const [draggingId, setDraggingId,] = createSignal<string | null>(null,);

    // Track which item cards have settings open (persists across re-renders)
    const [openSettings, setOpenSettings,] = createSignal<Set<string>>(new Set(),);
    const isSettingsOpen = (id: string,) => openSettings().has(id,);
    const toggleSettings = (id: string,) => {
        setOpenSettings((prev,) => {
            const next = new Set(prev,);
            if (next.has(id,)) next.delete(id,);
            else next.add(id,);
            return next;
        },);
    };
    const [ghostStyle, setGhostStyle,] = createSignal<
        { top: number; left: number; width: number; height: number; } | null
    >(null,);

    onMount(async () => {
        // Block mode: use initialData prop instead of API
        if (props.initialData) {
            const data = props.initialData;
            if (data.items?.length) {
                setItems(data.items.toSorted((a, b,) => a.order - b.order),);
            }
            if (data.options) {
                setOptions({ ...DEFAULT_OPTIONS, ...data.options, },);
            }
            setLoading(false,);
            return;
        }
        try {
            const data = await cms.settings.getHomepageHero() as HeroCarouselSettings;
            if (data) {
                if (data.items?.length) {
                    setItems(data.items.toSorted((a, b,) => a.order - b.order),);
                }
                if (data.options) {
                    setOptions({ ...DEFAULT_OPTIONS, ...data.options, },);
                }
            }
        } catch (e) {
            console.error('Failed to load hero settings:', e,);
        } finally {
            setLoading(false,);
        }
    },);

    const markDirty = () => {
        setIsDirty(true,);
        // In block mode, notify parent of every change
        if (props.onChange) {
            props.onChange({ items: items(), options: options(), },);
        }
    };

    // ─── Item CRUD ───

    const updateItem = (id: string, updater: (item: HeroItem,) => HeroItem,) => {
        setItems(prev => prev.map(item => item.id === id ? updater(item,) : item));
        markDirty();
    };

    const removeItem = (id: string,) => {
        setItems(prev => prev.filter(item => item.id !== id).map((item, i,) => ({ ...item, order: i, })));
        markDirty();
    };

    const addItemFromMedia = (media: { id: string; url: string; thumbnailUrl?: string; mimeType: string; },) => {
        const mediaType: HeroItem['mediaType'] = media.mimeType.startsWith('video/',) ? 'video' : 'image';
        const newItem: HeroItem = {
            id: genId(),
            mediaId: media.id,
            mediaUrl: media.url,
            mediaThumbnailUrl: media.thumbnailUrl,
            mediaType,
            objectFit: 'cover',
            autoplay: mediaType === 'video',
            order: items().length,
        };
        setItems(prev => [...prev, newItem,]);
        markDirty();
    };

    const addEntityItem = () => {
        const newItem: HeroItem = {
            id: genId(),
            type: 'entity',
            // Default to a specific-entity binding — the primary carousel use
            // ("pick specific entities, each its own slide"). The operator can
            // switch to a query in the item settings.
            entity: { templateId: '', entityType: '', binding: { mode: 'single', ref: '', }, },
            order: items().length,
        };
        setItems(prev => [...prev, newItem,]);
        // Open its settings immediately so the entity/template pickers are visible.
        setOpenSettings(prev => {
            const next = new Set(prev,);
            next.add(newItem.id,);
            return next;
        },);
        markDirty();
    };

    const updatePosts = (id: string, patch: Partial<HeroPostsConfig>,) => {
        updateItem(id, it => ({ ...it, posts: { ...(it.posts ?? {}), ...patch, }, }),);
    };

    /** EntityBlockEdit writes the whole `{ entity }` bag; lift `.entity` onto the item. */
    const updateEntity = (id: string, data: Record<string, any>,) => {
        updateItem(id, it => ({ ...it, entity: data.entity, }),);
    };

    /** Add-item dropdown dispatcher: minimal single control replacing the old
     *  three buttons. Selecting an action fires it, then the select resets. */
    const handleAddSelect = (value: string,) => {
        if (value === 'media-select') setShowMediaSelect(true,);
        else if (value === 'media-upload') setShowMediaUpload(true,);
        else if (value === 'entity') addEntityItem();
    };

    // ─── Options update ───

    const updateOptions = (patch: Partial<HeroCarouselOptions>,) => {
        setOptions(prev => ({ ...prev, ...patch, }));
        markDirty();
    };

    // ─── Save ───

    const handleSave = async () => {
        setSaving(true,);
        try {
            const payload: HeroCarouselSettings = {
                items: items().map((item, i,) => ({ ...item, order: i, })),
                options: options(),
            };
            await cms.settings.setHomepageHero(payload as any,);
            setIsDirty(false,);
            toast.success('Hero settings saved.',);
        } catch (e) {
            toast.error('Failed to save: ' + (e instanceof Error ? e.message : 'Unknown error'),);
            console.error(e,);
        } finally {
            setSaving(false,);
        }
    };

    // ─── Drag reorder (horizontal) ───

    const handleDragStart = (e: PointerEvent, id: string,) => {
        const cardEl = (e.target as HTMLElement).closest('.hero-item-card',) as HTMLElement;
        if (!cardEl) return;

        e.preventDefault();
        const rect = cardEl.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        setDraggingId(id,);
        setGhostStyle({ top: rect.top, left: rect.left, width: rect.width, height: rect.height, },);

        const listEl = cardEl.parentElement;
        let currentItems = [...items(),];
        let currentIndex = currentItems.findIndex(item => item.id === id);

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
            const cardEls = Array.from(listEl.querySelectorAll('.hero-item-card',),) as HTMLElement[];
            const cursorX = moveEvt.clientX;

            let newIndex = currentIndex;
            for (let i = 0; i < cardEls.length; i++) {
                const elRect = cardEls[i].getBoundingClientRect();
                const midX = elRect.left + elRect.width / 2;
                if (cursorX < midX) {
                    newIndex = i;
                    break;
                }
                newIndex = i + 1;
            }
            newIndex = Math.max(
                0,
                Math.min(currentItems.length - 1, newIndex > currentIndex ? newIndex - 1 : newIndex,),
            );

            if (newIndex !== currentIndex) {
                const arr = [...currentItems,];
                const [item,] = arr.splice(currentIndex, 1,);
                arr.splice(newIndex, 0, item,);
                currentItems = arr;
                currentIndex = newIndex;
                setItems(arr.map((it, i,) => ({ ...it, order: i, })),);
                markDirty();
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

    // ─── Preview height scaling ───

    const scaledHeight = createMemo(() => {
        const h = options().customHeight && options().height ? options().height : '50vh';
        const match = h.match(/^(\d+)(px|vw|vh|%)$/,);
        if (!match) return '200px';
        const value = parseInt(match[1],);
        const unit = match[2];
        const scale = 0.65;
        return `${Math.round(value * scale,)}${unit}`;
    },);

    // ─── Render helpers ───


    // ─── Main render ───

    return (
        <div class="hero-editor">
            <Show when={loading()}>
                <div class="hero-editor__loading">Loading hero settings...</div>
            </Show>

            <Show when={!loading()}>
                {/* ─── Preview ─── (only in the standalone homepage-hero editor;
                    inside a Carousel content block the block itself is the
                    preview, so hideHeader suppresses this) */}
                <Show when={!props.hideHeader}>
                    <div class="hero-preview">
                        <h3 class="hero-preview__title">Preview</h3>
                        <Show
                            when={items().length > 0}
                            fallback={
                                <div class="hero-preview__empty">
                                    Add hero items below to see a preview
                                </div>
                            }
                        >
                            <div class="hero-preview__container">
                                <ResolvedHeroCarousel
                                    items={items()}
                                    options={options()}
                                    previewMode={true}
                                    height={scaledHeight()}
                                    gutterWidth={gutterWidth()}
                                    renderEntitySlide={renderEntityTemplateSlide}
                                />
                            </div>
                        </Show>
                    </div>
                </Show>

                {/* ─── Carousel Options ─── (carousel/CarouselOptions.tsx) */}
                <CarouselOptions
                    options={options()}
                    onChange={updateOptions}
                    itemCount={items().length}
                    hideSave={props.hideHeader}
                    canSave={isDirty()}
                    saving={saving()}
                    onSave={handleSave}
                />

                {/* ─── Item Cards ─── */}
                <h3 class="hero-options__title">Carousel Items</h3>
                <div class={`hero-editor__items ${draggingId() ? 'hero-editor__items--dragging' : ''}`}>
                    <For each={storeItems}>
                        {(item,) => (
                                <div
                                    class={`hero-item-card ${draggingId() === item.id ? 'hero-item-card--dragging' : ''}`}
                                >
                                    {/* Preview — media thumbnail, or a labelled card
                                        for a Posts/Entity item (which expands into one
                                        slide per resolved record at render). */}
                                    <Switch
                                        fallback={
                                            <div class="hero-item-card__preview">
                                                <Show
                                                    when={item.mediaType === 'video'}
                                                    fallback={
                                                        <img
                                                            src={item.mediaThumbnailUrl || item.mediaUrl}
                                                            class="media-viewable"
                                                            {...viewMediaProps(() => item.mediaUrl,)}
                                                            alt=""
                                                            style={{ 'object-fit': item.objectFit || 'cover', }}
                                                        />
                                                    }
                                                >
                                                    <video
                                                        src={item.mediaUrl}
                                                        poster={item.mediaThumbnailUrl}
                                                        controls
                                                        muted
                                                        playsinline
                                                        style={{ 'object-fit': item.objectFit || 'cover', }}
                                                    />
                                                </Show>
                                            </div>
                                        }
                                    >
                                        <Match when={item.type === 'posts'}>
                                            <div class="hero-item-card__preview hero-item-card__preview--posts">
                                                <span class="hero-item-card__posts-badge">Posts</span>
                                                <span class="hero-item-card__posts-summary">
                                                    {postsSummary(item,)}
                                                </span>
                                            </div>
                                        </Match>
                                        <Match when={item.type === 'entity'}>
                                            <div class="hero-item-card__preview hero-item-card__preview--posts">
                                                <span class="hero-item-card__posts-badge">Entity</span>
                                                <span class="hero-item-card__posts-summary">
                                                    {entitySummary(item,)}
                                                </span>
                                            </div>
                                        </Match>
                                    </Switch>

                                    {/* Collapsible Settings */}
                                    <button
                                        class={`hero-item-card__settings-toggle ${isSettingsOpen(item.id,) ? 'hero-item-card__settings-toggle--open' : ''}`}
                                        onClick={() => toggleSettings(item.id,)}
                                    >
                                        <span>Settings</span>
                                        <span class="hero-item-card__settings-chevron">
                                            {isSettingsOpen(item.id,) ? '\u25B2' : '\u25BC'}
                                        </span>
                                    </button>

                                    <Show when={isSettingsOpen(item.id,)}>
                                        <div class="hero-item-card__body">
                                            <Switch
                                                fallback={
                                                    <>
                                                        {/* Object fit */}
                                                        <div class="hero-item-card__field">
                                                            <label class="hero-item-card__field-label">Object Fit</label>
                                                            <select
                                                                class="input input--sm input--select"
                                                                value={item.objectFit || 'cover'}
                                                                onChange={(e,) => {
                                                                    updateItem(item.id, it => ({
                                                                        ...it,
                                                                        objectFit: e.currentTarget.value as HeroItem['objectFit'],
                                                                    }),);
                                                                }}
                                                            >
                                                                <For each={OBJECT_FIT_OPTIONS}>
                                                                    {(opt,) => <option value={opt}>{opt}</option>}
                                                                </For>
                                                            </select>
                                                        </div>

                                                        {/* Autoplay (video only) */}
                                                        <Show when={item.mediaType === 'video'}>
                                                            <div class="hero-item-card__toggle">
                                                                <Toggle
                                                                    checked={item.autoplay ?? true}
                                                                    onChange={(next,) => {
                                                                        updateItem(item.id, it => ({
                                                                            ...it,
                                                                            autoplay: next,
                                                                        }),);
                                                                    }}
                                                                    label="Autoplay"
                                                                />
                                                            </div>
                                                        </Show>

                                                        {/* Header */}
                                                        <TextOverlaySection item={item} field="header" label="Header" updateItem={updateItem} />

                                                        {/* Subheader */}
                                                        <TextOverlaySection item={item} field="subheader" label="Subheader" updateItem={updateItem} />

                                                        {/* Action */}
                                                        <ActionSection item={item} updateItem={updateItem} />
                                                    </>
                                                }
                                            >
                                                {/* Posts item (legacy data): query
                                                    settings. Each resolved post renders
                                                    as its own slide. */}
                                                <Match when={item.type === 'posts'}>
                                                    <PostQueryEditor
                                                        value={item.posts ?? {}}
                                                        onChange={(patch,) => updatePosts(item.id, patch,)}
                                                    />
                                                </Match>
                                                {/* Entity item: pick entity type →
                                                    template → binding. Each resolved
                                                    record renders as its own slide. */}
                                                <Match when={item.type === 'entity'}>
                                                    <EntityBlockEdit
                                                        mode="edit"
                                                        data={{ entity: item.entity, }}
                                                        onUpdate={(d,) => updateEntity(item.id, d,)}
                                                    />
                                                </Match>
                                            </Switch>
                                        </div>
                                    </Show>

                                    {/* Footer: drag + delete */}
                                    <div class="hero-item-card__footer">
                                        <button
                                            class="hero-item-card__drag-handle"
                                            onPointerDown={(e,) => handleDragStart(e, item.id,)}
                                            title="Drag to reorder"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="18"
                                                height="18"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                            >
                                                <circle cx="9" cy="6" r="1" fill="currentColor" />
                                                <circle cx="15" cy="6" r="1" fill="currentColor" />
                                                <circle cx="9" cy="12" r="1" fill="currentColor" />
                                                <circle cx="15" cy="12" r="1" fill="currentColor" />
                                                <circle cx="9" cy="18" r="1" fill="currentColor" />
                                                <circle cx="15" cy="18" r="1" fill="currentColor" />
                                            </svg>
                                        </button>
                                        <button
                                            class="btn btn--xs btn--danger-ghost"
                                            onClick={() => {
                                                if (confirm('Remove this hero item?',)) {
                                                    removeItem(item.id,);
                                                }
                                            }}
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                width="16"
                                                height="16"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="2"
                                            >
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            </svg>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                        )}
                    </For>

                    {/* Add new item — one minimal dropdown (Media / Entities). */}
                    <div class="hero-add-card hero-add-card--compact">
                        <div class="hero-add-card__content">
                            <span class="hero-add-card__label">
                                <span class="hero-add-card__icon">+</span> Add item
                            </span>
                            <select
                                class="input input--sm input--select hero-add-card__select"
                                value=""
                                onChange={(e,) => {
                                    handleAddSelect(e.currentTarget.value,);
                                    e.currentTarget.value = '';
                                }}
                            >
                                <option value="" disabled>Choose…</option>
                                <optgroup label="Media">
                                    <option value="media-select">Select existing media</option>
                                    <option value="media-upload">Upload new media</option>
                                </optgroup>
                                <optgroup label="Entities">
                                    <option value="entity">Add entities (template)</option>
                                </optgroup>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Drag ghost */}
                <Show when={ghostStyle()}>
                    {(style,) => (
                        <div
                            class="hero-item-card-ghost"
                            style={{
                                position: 'fixed',
                                top: `${style().top}px`,
                                left: `${style().left}px`,
                                width: `${style().width}px`,
                                height: `${style().height}px`,
                            }}
                        >
                            <div class="hero-item-card-ghost__inner">
                                <svg
                                    viewBox="0 0 24 24"
                                    width="20"
                                    height="20"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                                    <circle cx="15" cy="6" r="1" fill="currentColor" />
                                    <circle cx="9" cy="12" r="1" fill="currentColor" />
                                    <circle cx="15" cy="12" r="1" fill="currentColor" />
                                    <circle cx="9" cy="18" r="1" fill="currentColor" />
                                    <circle cx="15" cy="18" r="1" fill="currentColor" />
                                </svg>
                                <span>Moving hero item...</span>
                            </div>
                        </div>
                    )}
                </Show>
            </Show>

            {/* ─── Modals ─── */}
            <Show when={showMediaSelect()}>
                <MediaSelectModal
                    types={['image', 'video',]}
                    onSelect={(media,) => {
                        addItemFromMedia({
                            id: media.id,
                            url: media.url,
                            thumbnailUrl: media.thumbnailUrl,
                            mimeType: media.mimeType,
                        },);
                        setShowMediaSelect(false,);
                    }}
                    onClose={() => setShowMediaSelect(false,)}
                />
            </Show>

            <Show when={showMediaUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*,video/*"
                    onUploaded={(media,) => {
                        addItemFromMedia({
                            id: media.id,
                            url: media.url,
                            thumbnailUrl: media.thumbnailUrl,
                            mimeType: media.mimeType,
                        },);
                        setShowMediaUpload(false,);
                    }}
                    onClose={() => setShowMediaUpload(false,)}
                />
            </Show>
        </div>
    );
};

export default HeroContentEditor;
