import type {
    HeroActionConfig,
    HeroButtonSize,
    HeroCarouselOptions,
    HeroCarouselSettings,
    HeroItem,
    HeroPostsConfig,
    HeroTextConfig,
} from '@sitesurge/types';
import type { AppearanceSettings, } from '@sitesurge/types';
import { Component, createEffect, createMemo, createResource, createSignal, For, Index, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ResolvedHeroCarousel from '../../blocks/ResolvedHeroCarousel';
import { useToast, } from '../../common/toast';
import ColorPicker from '../appearance/ColorPicker';
import MediaSelectModal from '../media/MediaSelectModal';
import MediaUploadModal from '../media/MediaUploadModal';
import PostQueryEditor from './PostQueryEditor';
import Tooltip from '../common/Tooltip';
import Toggle from '../common/Toggle';
import './HeroContentEditor.scss';

const genId = () => 'hero-' + Date.now() + '-' + Math.random().toString(36,).slice(2, 7,);

/** One-line summary of a Posts item's query, for its card preview. */
function postsSummary(item: HeroItem,): string {
    const cfg = item.posts ?? {};
    const parts: string[] = [];
    const pinned = cfg.pinnedPostIds?.length ?? 0;
    if (pinned > 0) parts.push(`${pinned} specific`,);
    if (cfg.queryEnabled !== false) parts.push(`query · ${cfg.count ?? 5}`,);
    return parts.length ? parts.join(' + ',) : 'No posts configured';
}

const isValidHeight = (v: string,) => /^\d+(px|vw|vh|%)$/.test(v,);

const OBJECT_FIT_OPTIONS: HeroItem['objectFit'][] = ['cover', 'contain', 'fill', 'none', 'scale-down',];
const HEADING_SIZES: HeroTextConfig['size'][] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6',];

const DEFAULT_OPTIONS: HeroCarouselOptions = {
    autoScroll: false,
    autoScrollInterval: 3000,
    repeat: true,
    customHeight: false,
    height: '50vh',
};

/** Local-state text input — syncs to parent on blur or Enter, not every keystroke */
function TextInput(props: { value: string; placeholder?: string; rows?: number; onUpdate: (val: string,) => void; },) {
    const [local, setLocal,] = createSignal(props.value,);
    let lastExternal = props.value;

    // Sync from parent only when the external value truly changes (e.g. initial load, reset)
    createEffect(() => {
        const v = props.value;
        if (v !== lastExternal) {
            lastExternal = v;
            setLocal(v,);
        }
    },);

    const commit = () => {
        if (local() !== lastExternal) {
            lastExternal = local();
            props.onUpdate(local(),);
        }
    };

    return (
        <textarea
            rows={props.rows || 2}
            class="input input--sm"
            placeholder={props.placeholder}
            value={local()}
            onInput={(e,) => setLocal(e.currentTarget.value,)}
            onBlur={commit}
            onKeyDown={(e,) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    commit();
                }
            }}
        />
    );
}

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

    const addPostsItem = () => {
        const newItem: HeroItem = {
            id: genId(),
            type: 'posts',
            posts: { queryEnabled: true, count: 5, showEmptyMessage: true, pinnedPostIds: [], },
            order: items().length,
        };
        setItems(prev => [...prev, newItem,]);
        // Open its settings immediately so the query options are visible.
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

    const renderTextSection = (
        item: HeroItem,
        field: 'header' | 'subheader',
        label: string,
    ) => {
        const config = item[field] as HeroTextConfig | undefined;
        return (
            <div class="hero-item-card__section">
                <Show
                    when={config}
                    fallback={
                        <button
                            class="btn btn--sm btn--ghost"
                            onClick={() => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    [field]: {
                                        text: '',
                                        size: field === 'header' ? 'h1' : 'h3',
                                        color: '#ffffff',
                                    } as HeroTextConfig,
                                }),);
                            }}
                        >
                            + Add {label}
                        </button>
                    }
                >
                    <div class="hero-item-card__section-header">
                        <span class="hero-item-card__section-label">{label}</span>
                        <button
                            class="btn btn--xs btn--danger-ghost"
                            onClick={() => {
                                updateItem(item.id, it => {
                                    const updated = { ...it, };
                                    delete (updated as any)[field];
                                    return updated;
                                },);
                            }}
                        >
                            Remove
                        </button>
                    </div>
                    <TextInput
                        value={config?.text || ''}
                        placeholder={`${label} text...`}
                        rows={2}
                        onUpdate={(val,) => {
                            updateItem(item.id, it => ({
                                ...it,
                                [field]: { ...it[field]!, text: val, },
                            }),);
                        }}
                    />
                    <div class="hero-item-card__row">
                        <select
                            class="input input--sm input--select"
                            value={config?.size || 'h1'}
                            onChange={(e,) => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    [field]: { ...it[field]!, size: e.currentTarget.value as HeroTextConfig['size'], },
                                }),);
                            }}
                        >
                            <For each={HEADING_SIZES}>
                                {(size,) => <option value={size}>{size.toUpperCase()}</option>}
                            </For>
                        </select>
                        <ColorPicker
                            value={config?.color || '#ffffff'}
                            onChange={(color,) => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    [field]: { ...it[field]!, color, },
                                }),);
                            }}
                        />
                    </div>
                </Show>
            </div>
        );
    };

    const renderActionSection = (item: HeroItem,) => {
        const action = item.action;
        return (
            <div class="hero-item-card__section">
                <Show
                    when={action}
                    fallback={
                        <button
                            class="btn btn--sm btn--ghost"
                            onClick={() => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    action: {
                                        label: '',
                                        url: '',
                                        openInNewTab: false,
                                        size: 'small',
                                    } as HeroActionConfig,
                                }),);
                            }}
                        >
                            + Add Action
                        </button>
                    }
                >
                    <div class="hero-item-card__section-header">
                        <span class="hero-item-card__section-label">Action</span>
                        <button
                            class="btn btn--xs btn--danger-ghost"
                            onClick={() => {
                                updateItem(item.id, it => {
                                    const updated = { ...it, };
                                    delete updated.action;
                                    return updated;
                                },);
                            }}
                        >
                            Remove
                        </button>
                    </div>
                    <input
                        type="text"
                        class="input input--sm"
                        placeholder="Button label"
                        value={action?.label || ''}
                        onChange={(e,) => {
                            updateItem(item.id, it => ({
                                ...it,
                                action: { ...it.action!, label: e.currentTarget.value, },
                            }),);
                        }}
                    />
                    <input
                        type="text"
                        class="input input--sm"
                        placeholder="URL (e.g. /donate)"
                        value={action?.url || ''}
                        onChange={(e,) => {
                            updateItem(item.id, it => ({
                                ...it,
                                action: { ...it.action!, url: e.currentTarget.value, },
                            }),);
                        }}
                    />
                    <div class="hero-item-card__field">
                        <label class="hero-item-card__field-label">Button Size</label>
                        <select
                            class="input input--sm input--select"
                            value={action?.size || 'small'}
                            onChange={(e,) => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    action: { ...it.action!, size: e.currentTarget.value as HeroButtonSize, },
                                }),);
                            }}
                        >
                            <option value="small">Small</option>
                            <option value="normal">Normal</option>
                            <option value="large">Large</option>
                        </select>
                    </div>
                    <div class="hero-item-card__toggle">
                        <Toggle
                            checked={action?.openInNewTab || false}
                            onChange={(next,) => {
                                updateItem(item.id, it => ({
                                    ...it,
                                    action: { ...it.action!, openInNewTab: next, },
                                }),);
                            }}
                            label="Open in new tab"
                        />
                    </div>
                </Show>
            </div>
        );
    };

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
                                />
                            </div>
                        </Show>
                    </div>
                </Show>

                {/* ─── Carousel Options ─── */}
                <div class="hero-options">
                    <h3 class="hero-options__title">Carousel Options</h3>
                    <div class="hero-options__row">
                        <Show when={!props.hideHeader}>
                            <button
                                class="btn btn--primary btn--small"
                                disabled={!isDirty() || saving()}
                                onClick={handleSave}
                            >
                                {saving() ? 'Saving...' : 'Save Carousel'}
                            </button>
                        </Show>
                        {/* Auto-scroll */}
                        <div class="hero-options__group">
                            <Toggle
                                checked={options().autoScroll}
                                disabled={items().length <= 1}
                                onChange={(next,) => updateOptions({ autoScroll: next, },)}
                                ariaLabel="Auto-scroll"
                            />
                            <span class="hero-options__label">Auto-scroll</span>
                            <Show when={options().autoScroll}>
                                <input
                                    type="number"
                                    class="input input--sm input--inline-number"
                                    min={500}
                                    step={500}
                                    value={options().autoScrollInterval}
                                    onInput={(e,) => {
                                        const val = parseInt(e.currentTarget.value,);
                                        if (!isNaN(val,) && val >= 500) {
                                            updateOptions({ autoScrollInterval: val, },);
                                        }
                                    }}
                                />
                                <span class="hero-options__unit">ms</span>
                            </Show>
                        </div>

                        {/* Repeat */}
                        <div class="hero-options__group">
                            <Toggle
                                checked={options().repeat}
                                disabled={items().length <= 1}
                                onChange={(next,) => updateOptions({ repeat: next, },)}
                                ariaLabel="Repeat"
                            />
                            <span class="hero-options__label">Repeat</span>
                        </div>

                        {/* Custom height */}
                        <div class="hero-options__group">
                            <Toggle
                                checked={options().customHeight}
                                onChange={(next,) => updateOptions({ customHeight: next, },)}
                                ariaLabel="Custom height"
                            />
                            <span class="hero-options__label">Custom height</span>
                            <Show when={options().customHeight}>
                                <input
                                    type="text"
                                    class={`input input--sm input--inline-text ${
                                        !isValidHeight(options().height || '',) ? 'input--error' : ''
                                    }`}
                                    placeholder="50vh"
                                    value={options().height || ''}
                                    onInput={(e,) => updateOptions({ height: e.currentTarget.value, },)}
                                />
                            </Show>
                            <Tooltip
                                header="Height Values"
                                content={
                                    <div>
                                        <p>
                                            <code>px</code> — Fixed pixel height (e.g.{' '}
                                            <code>600px</code>). Stays the same size on all screens.
                                        </p>
                                        <p>
                                            <code>vh</code> — Percentage of viewport height (e.g. <code>50vh</code>{' '}
                                            = half the screen). Scales with the browser window height.
                                        </p>
                                        <p>
                                            <code>vw</code> — Percentage of viewport width (e.g.{' '}
                                            <code>30vw</code>). Scales with the browser window width — useful for
                                            maintaining aspect ratio.
                                        </p>
                                        <p>
                                            <code>%</code> — Percentage of the parent container (e.g.{' '}
                                            <code>50%</code>). Relative to the element the hero sits inside.
                                        </p>
                                    </div>
                                }
                            />
                        </div>

                        {/* Apply gutter */}
                        <div class="hero-options__group">
                            <Toggle
                                checked={options().applyGutter || false}
                                onChange={(next,) => updateOptions({ applyGutter: next, },)}
                                ariaLabel="Apply Site Gutter"
                            />
                            <span class="hero-options__label">Apply Site Gutter</span>
                        </div>
                    </div>
                </div>

                {/* ─── Item Cards ─── */}
                <h3 class="hero-options__title">Carousel Items</h3>
                <div class={`hero-editor__items ${draggingId() ? 'hero-editor__items--dragging' : ''}`}>
                    <For each={items()}>
                        {(item,) => (
                                <div
                                    class={`hero-item-card ${draggingId() === item.id ? 'hero-item-card--dragging' : ''}`}
                                >
                                    {/* Preview — media thumbnail, or a labelled
                                        card for a Posts item (which expands into
                                        one slide per resolved post at render). */}
                                    <Show
                                        when={item.type === 'posts'}
                                        fallback={
                                            <div class="hero-item-card__preview">
                                                <Show
                                                    when={item.mediaType === 'video'}
                                                    fallback={
                                                        <img
                                                            src={item.mediaThumbnailUrl || item.mediaUrl}
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
                                        <div class="hero-item-card__preview hero-item-card__preview--posts">
                                            <span class="hero-item-card__posts-badge">Posts</span>
                                            <span class="hero-item-card__posts-summary">
                                                {postsSummary(item,)}
                                            </span>
                                        </div>
                                    </Show>

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
                                            <Show
                                                when={item.type === 'posts'}
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
                                                        {renderTextSection(item, 'header', 'Header',)}

                                                        {/* Subheader */}
                                                        {renderTextSection(item, 'subheader', 'Subheader',)}

                                                        {/* Action */}
                                                        {renderActionSection(item,)}
                                                    </>
                                                }
                                            >
                                                {/* Posts item: query settings. Each
                                                    resolved post renders as its own slide. */}
                                                <PostQueryEditor
                                                    value={item.posts ?? {}}
                                                    onChange={(patch,) => updatePosts(item.id, patch,)}
                                                />
                                            </Show>
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

                    {/* Add new item card */}
                    <div class="hero-add-card">
                        <div class="hero-add-card__content">
                            <span class="hero-add-card__icon">+</span>
                            <span class="hero-add-card__label">Add Hero Item</span>
                            <button
                                class="btn btn--sm btn--secondary"
                                onClick={() => setShowMediaSelect(true,)}
                            >
                                Select Existing Media
                            </button>
                            <button
                                class="btn btn--sm btn--outline"
                                onClick={() => setShowMediaUpload(true,)}
                            >
                                Upload New Media
                            </button>
                            <button
                                class="btn btn--sm btn--outline"
                                onClick={addPostsItem}
                            >
                                Select Posts
                            </button>
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
