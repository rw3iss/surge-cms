import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { fetchSiteHeader, saveSiteHeader, } from '../../../services/api';
import { colorCssValue, } from '../../../services/colorResolver';
import { useToast, } from '../../common/toast';
import ColorPicker from '../appearance/ColorPicker';
import MediaSelectModal from '../media/MediaSelectModal';
import MediaUploadModal from '../media/MediaUploadModal';
import Tooltip from '../common/Tooltip';
import './SiteHeaderEditor.scss';

// ─── Types ───

type HeaderItemType = 'image' | 'image_link' | 'text' | 'text_link' | 'button' | 'menu' | 'gap' | 'flex_spacer';

interface SiteHeaderItem {
    id: string;
    type: HeaderItemType;
    text?: string;
    url?: string;
    imageUrl?: string;
    mediaId?: string;
    openInNewTab?: boolean;
    buttonColor?: string;
    fontSize?: string;
    /** CSS font-weight ('100'..'900' or keyword). Empty/undefined → inherit. */
    fontWeight?: string;
    textColor?: string;
    width?: string;
    alignment?: string;
    verticalAlignment?: string;
    margin?: string;
    padding?: string;
    order: number;
}

const genId = () => 'hdr-' + Date.now() + '-' + Math.random().toString(36,).slice(2, 7,);

const DEFAULT_ITEM: Partial<SiteHeaderItem> = {
    type: 'text_link',
    text: 'New Link',
    url: '/',
    fontSize: '16px',
    textColor: '#000000',
    alignment: 'center',
};

const FONT_SIZE_OPTIONS = [
    '8px',
    '10px',
    '12px',
    '14px',
    '16px',
    '18px',
    '20px',
    '22px',
    '24px',
    '26px',
    '28px',
    '30px',
    '32px',
];

const WIDTH_OPTIONS = ['auto', '100%', '50%', '33.333%', '25%', '20%',];
const PADDING_OPTIONS = ['0px', '5px', '10px', '15px', '20px', '30px',];
const MARGIN_OPTIONS = ['0px', '5px', '10px', '15px', '20px', '30px',];

// Font weight options. Empty value = "default" (inherit). Numeric
// weights map 1:1 to the CSS font-weight values most variable + system
// fonts support; the keyword aliases (Light, Regular, Bold, etc.) help
// non-CSS-savvy users pick the right one.
const FONT_WEIGHT_OPTIONS: { value: string; label: string; }[] = [
    { value: '', label: 'Default', },
    { value: '100', label: '100 — Thin', },
    { value: '200', label: '200 — Extra Light', },
    { value: '300', label: '300 — Light', },
    { value: '400', label: '400 — Regular', },
    { value: '500', label: '500 — Medium', },
    { value: '600', label: '600 — Semibold', },
    { value: '700', label: '700 — Bold', },
    { value: '800', label: '800 — Extrabold', },
    { value: '900', label: '900 — Black', },
];

const HEADER_ITEM_TYPES: { value: HeaderItemType; label: string; }[] = [
    { value: 'image', label: 'Image', },
    { value: 'image_link', label: 'Image Link', },
    { value: 'text', label: 'Text', },
    { value: 'text_link', label: 'Text Link', },
    { value: 'button', label: 'Button', },
    { value: 'menu', label: 'Menu', },
    { value: 'gap', label: 'Gap', },
    { value: 'flex_spacer', label: 'Flex Spacer', },
];

/** Auto-append 'px' if value is a bare integer (e.g. "10" → "10px") */
const normalizeCssValue = (val: string,): string => {
    const trimmed = val.trim();
    if (!trimmed) return trimmed;
    if (/^\d+$/.test(trimmed,)) return `${trimmed}px`;
    return trimmed;
};

const isCustomValue = (value: string | undefined, presets: string[],): boolean => {
    if (!value) return false;
    return !presets.includes(value,);
};

const SiteHeaderEditor: Component = () => {
    const toast = useToast();

    // ─── State ───
    const [items, setItems,] = createSignal<SiteHeaderItem[]>([],);
    const [bgColor, setBgColor,] = createSignal('#ffffff',);
    const [textColor, setTextColor,] = createSignal('#000000',);
    const [headerPadding, setHeaderPadding,] = createSignal('0px',);
    const [headerMargin, setHeaderMargin,] = createSignal('0px',);
    const [itemSpacing, setItemSpacing,] = createSignal('',);
    const [applyGutter, setApplyGutter,] = createSignal(false,);
    /** Sticky default = true preserves the historic behavior for
     *  existing sites; new toggles save the explicit value. */
    const [sticky, setSticky,] = createSignal(true,);
    const [autoHide, setAutoHide,] = createSignal(false,);
    const [selectedItemId, setSelectedItemId,] = createSignal<string | null>(null,);
    const [isDirty, setIsDirty,] = createSignal(false,);
    const [saving, setSaving,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(true,);

    // Edit panel local state
    const [editItem, setEditItem,] = createSignal<SiteHeaderItem | null>(null,);

    // Media modals
    const [showSettings, setShowSettings,] = createSignal(false,);
    const [showMediaSelect, setShowMediaSelect,] = createSignal(false,);
    const [showMediaUpload, setShowMediaUpload,] = createSignal(false,);

    // Custom input toggles
    const [customWidth, setCustomWidth,] = createSignal(false,);
    const [customPadding, setCustomPadding,] = createSignal(false,);
    const [customMargin, setCustomMargin,] = createSignal(false,);

    // Drag state
    const [draggingId, setDraggingId,] = createSignal<string | null>(null,);
    const [ghostStyle, setGhostStyle,] = createSignal<
        { top: number; left: number; width: number; height: number; } | null
    >(null,);

    // ─── Load ───

    onMount(async () => {
        try {
            const res = await fetchSiteHeader();
            if (res.success && res.data) {
                const data = res.data as any;
                if (data.items?.length) {
                    setItems(data.items.toSorted((a: SiteHeaderItem, b: SiteHeaderItem,) => a.order - b.order),);
                }
                if (data.backgroundColor) setBgColor(data.backgroundColor,);
                if (data.textColor) setTextColor(data.textColor,);
                if (data.padding) setHeaderPadding(data.padding,);
                if (data.margin) setHeaderMargin(data.margin,);
                if (data.itemSpacing) setItemSpacing(data.itemSpacing,);
                if (data.applyGutter) setApplyGutter(data.applyGutter,);
                // Coerce explicitly: default to true (preserve historic
                // behavior) when the field is missing on legacy rows.
                setSticky(data.sticky !== false,);
                setAutoHide(data.autoHide === true,);
            }
        } catch (e) {
            console.error('Failed to load site header settings:', e,);
        } finally {
            setLoading(false,);
        }
    },);

    const markDirty = () => setIsDirty(true,);

    // ─── Selected item helpers ───

    const selectedItem = () => items().find(i => i.id === selectedItemId()) || null;

    const selectItem = (id: string,) => {
        setSelectedItemId(id,);
        const item = items().find(i => i.id === id);
        if (item) {
            setEditItem({ ...item, },);
            setCustomWidth(isCustomValue(item.width, WIDTH_OPTIONS,),);
            setCustomPadding(isCustomValue(item.padding, PADDING_OPTIONS,),);
            setCustomMargin(isCustomValue(item.margin, MARGIN_OPTIONS,),);
        }
    };

    const updateEditField = (field: keyof SiteHeaderItem, value: any,) => {
        setEditItem(prev => {
            if (!prev) return null;
            const updated = { ...prev, [field]: value, };
            // Auto-persist to items array so preview and save always reflect edits
            setItems(list => list.map(i => i.id === updated.id ? { ...updated, } : i));
            markDirty();
            return updated;
        });
    };

    const handleSaveItem = () => {
        const edit = editItem();
        if (!edit) return;
        setItems(prev => prev.map(i => i.id === edit.id ? { ...edit, } : i));
        markDirty();
        toast.success('Item updated.',);
    };

    const handleCancelEdit = () => {
        setSelectedItemId(null,);
        setEditItem(null,);
    };

    const handleResetItem = () => {
        const id = selectedItemId();
        if (!id) return;
        const original = items().find(i => i.id === id);
        if (original) {
            setEditItem({ ...original, },);
        }
    };

    // ─── Item CRUD ───

    const addItem = () => {
        const newItem: SiteHeaderItem = {
            id: genId(),
            ...DEFAULT_ITEM,
            order: items().length,
        } as SiteHeaderItem;
        setItems(prev => [...prev, newItem,]);
        markDirty();
        selectItem(newItem.id,);
    };

    const removeItem = (id: string,) => {
        if (selectedItemId() === id) {
            setSelectedItemId(null,);
            setEditItem(null,);
        }
        setItems(prev => prev.filter(i => i.id !== id).map((i, idx,) => ({ ...i, order: idx, })));
        markDirty();
    };

    // ─── Save ───

    const handleSave = async () => {
        setSaving(true,);
        try {
            const payload = {
                items: items().map((item, i,) => ({ ...item, order: i, })),
                backgroundColor: bgColor(),
                textColor: textColor(),
                padding: headerPadding(),
                margin: headerMargin(),
                itemSpacing: itemSpacing() || undefined,
                applyGutter: applyGutter(),
                sticky: sticky(),
                autoHide: autoHide(),
            };
            const res = await saveSiteHeader(payload,);
            if (res.success) {
                setIsDirty(false,);
                toast.success('Site header saved.',);
            } else {
                toast.error('Failed to save: ' + ((res as any).error?.message || 'Unknown error'),);
            }
        } catch (e) {
            toast.error('Failed to save site header.',);
            console.error(e,);
        } finally {
            setSaving(false,);
        }
    };

    // ─── Drag reorder (horizontal) ───

    const handleDragStart = (e: PointerEvent, id: string,) => {
        const cardEl = (e.target as HTMLElement).closest('.site-header-preview__item',) as HTMLElement;
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
            const cardEls = Array.from(listEl.querySelectorAll('.site-header-preview__item',),) as HTMLElement[];
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

    // ─── Render helpers ───

    const renderItemPreview = (item: SiteHeaderItem,) => {
        switch (item.type) {
            case 'image':
                return (
                    <Show when={item.imageUrl} fallback={<span class="site-header-preview__placeholder">IMG</span>}>
                        <img src={item.imageUrl} alt="" class="site-header-preview__img" />
                    </Show>
                );
            case 'image_link': {
                // Mirror the public Header's alignment logic: a column-
                // flex wrapper aligns the image horizontally via
                // align-items. The previous margin-auto approach had
                // no effect because the image was forced to width:
                // 100% of the wrapper — there was no free space.
                const alignMap: Record<string, string> = {
                    left: 'flex-start',
                    center: 'center',
                    right: 'flex-end',
                };
                const hAlign = item.alignment || 'center';
                return (
                    <Show when={item.imageUrl} fallback={<span class="site-header-preview__placeholder">IMG</span>}>
                        <div
                            style={{
                                display: 'flex',
                                'flex-direction': 'column',
                                'align-items': alignMap[hAlign] || 'center',
                                width: '100%',
                            }}
                        >
                            <img
                                src={item.imageUrl}
                                alt=""
                                class="site-header-preview__img"
                                style={{
                                    display: 'block',
                                    'max-width': '100%',
                                    height: 'auto',
                                }}
                            />
                        </div>
                    </Show>
                );
            }
            case 'text':
            case 'text_link':
            case 'menu':
                return <span class="site-header-preview__text">{item.text || 'Text'}</span>;
            case 'button':
                return (
                    <span
                        class="site-header-preview__button"
                        style={{ background: colorCssValue(item.buttonColor, '#333',), }}
                    >
                        {item.text || 'Button'}
                    </span>
                );
            case 'gap':
                return <span class="site-header-preview__gap">{item.width || '20px'}</span>;
            case 'flex_spacer':
                return <span class="site-header-preview__spacer">{'<->'}</span>;
            default:
                return <span>{item.type}</span>;
        }
    };

    const needsText = (type: HeaderItemType,) => ['text', 'text_link', 'button', 'menu',].includes(type,);

    const needsUrl = (type: HeaderItemType,) => ['text_link', 'button', 'image_link',].includes(type,);

    const needsImage = (type: HeaderItemType,) => ['image', 'image_link',].includes(type,);

    const needsButtonColor = (type: HeaderItemType,) => type === 'button';

    const needsCommonStyles = (type: HeaderItemType,) => !['gap', 'flex_spacer',].includes(type,);

    const handleMediaSelect = (media: any,) => {
        updateEditField('imageUrl', media.url,);
        updateEditField('mediaId', media.id,);
        setShowMediaSelect(false,);
    };

    const handleMediaUpload = (media: any,) => {
        updateEditField('imageUrl', media.url,);
        updateEditField('mediaId', media.id,);
        setShowMediaUpload(false,);
    };

    // ─── Render ───

    return (
        <div class="site-header-editor">
            <Show when={loading()}>
                <div class="site-header-editor__loading">Loading header settings...</div>
            </Show>

            <Show when={!loading()}>
                {/* ─── Preview bar ─── */}
                <p class="form-help" style={{ 'margin-bottom': '8px', }}>
                    Click an item to edit it. Drag items to reorder.
                </p>
                <div
                    class={`site-header-preview ${draggingId() ? 'site-header-preview--dragging' : ''}`}
                    style={{
                        background: colorCssValue(bgColor(), '',) || undefined,
                        color: colorCssValue(textColor(), '',) || undefined,
                        gap: itemSpacing() || undefined,
                        padding: headerPadding() || undefined,
                        margin: headerMargin() || undefined,
                    }}
                >
                    <Show
                        when={items().length > 0}
                        fallback={
                            <div class="site-header-preview__empty">
                                No header items yet. Click "Add Header Item" above.
                            </div>
                        }
                    >
                        <For each={items()}>
                            {(item,) => {
                                const typeClass = item.type === 'gap' ?
                                    'site-header-preview__item--gap' :
                                    item.type === 'flex_spacer' ?
                                    'site-header-preview__item--spacer' :
                                    '';
                                const inlineStyle: Record<string, string | undefined> = {};
                                if (item.type === 'gap' && item.width) {
                                    inlineStyle.width = item.width;
                                    inlineStyle['min-width'] = item.width;
                                } else if (item.type === 'flex_spacer' && item.width) {
                                    inlineStyle['max-width'] = item.width;
                                } else if (item.width) {
                                    inlineStyle.width = item.width;
                                }
                                // For image types with width, use block so img fills; image_link
                                // uses flex internally via its own rendered wrapper
                                if (item.type === 'image' && item.width) {
                                    inlineStyle.display = 'block';
                                }
                                if (item.fontSize) inlineStyle['font-size'] = item.fontSize;
                                if (item.fontWeight) inlineStyle['font-weight'] = item.fontWeight;
                                {
                                    const tc = colorCssValue(item.textColor, '',);
                                    if (tc) inlineStyle.color = tc;
                                }
                                if (item.padding) inlineStyle.padding = item.padding;
                                if (item.margin) inlineStyle.margin = item.margin;
                                if (item.alignment) inlineStyle['text-align'] = item.alignment;

                                return (
                                    <div
                                        class={`site-header-preview__item ${typeClass} ${
                                            selectedItemId() === item.id ? 'site-header-preview__item--selected' : ''
                                        } ${draggingId() === item.id ? 'site-header-preview__item--dragging' : ''}`}
                                        style={inlineStyle}
                                        onClick={() => selectItem(item.id,)}
                                        onPointerDown={(e,) => handleDragStart(e, item.id,)}
                                    >
                                        {renderItemPreview(item,)}
                                        <button
                                            class="site-header-preview__delete"
                                            onClick={(e,) => {
                                                e.stopPropagation();
                                                removeItem(item.id,);
                                            }}
                                            title="Remove item"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                );
                            }}
                        </For>
                    </Show>
                </div>

                {/* Drag ghost */}
                <Show when={ghostStyle()}>
                    {(style,) => (
                        <div
                            class="site-header-preview__ghost"
                            style={{
                                position: 'fixed',
                                top: `${style().top}px`,
                                left: `${style().left}px`,
                                width: `${style().width}px`,
                                height: `${style().height}px`,
                            }}
                        >
                            Moving...
                        </div>
                    )}
                </Show>

                <div class="site-header-editor__toolbar">
                    <button
                        class="btn btn--primary btn--small"
                        disabled={!isDirty() || saving()}
                        onClick={handleSave}
                    >
                        {saving() ? 'Saving...' : 'Save Header'}
                    </button>
                    <button class="btn btn--secondary btn--small" onClick={addItem}>
                        + Add Header Item
                    </button>
                    <button
                        class="btn btn--ghost btn--small"
                        onClick={() => setShowSettings(!showSettings(),)}
                    >
                        {showSettings() ? 'Hide Settings' : 'Settings'}
                    </button>
                </div>

                {/* ─── Collapsible Settings ─── */}
                <Show when={showSettings()}>
                    <div class="site-header-editor__settings">
                        <div class="site-header-editor__field">
                            <label class="site-header-editor__label">Background</label>
                            <ColorPicker
                                value={bgColor()}
                                onChange={(hex,) => {
                                    setBgColor(hex,);
                                    markDirty();
                                }}
                                clearable
                                onClear={() => {
                                    setBgColor('',);
                                    markDirty();
                                }}
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="site-header-editor__label">Text Color</label>
                            <ColorPicker
                                value={textColor()}
                                onChange={(hex,) => {
                                    setTextColor(hex,);
                                    markDirty();
                                }}
                                clearable
                                onClear={() => {
                                    setTextColor('',);
                                    markDirty();
                                }}
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="site-header-editor__label">Padding</label>
                            <input
                                type="text"
                                class="site-header-editor__input--sm"
                                value={headerPadding()}
                                onInput={(e,) => {
                                    setHeaderPadding(e.currentTarget.value,);
                                    markDirty();
                                }}
                                onBlur={(e,) => {
                                    const v = normalizeCssValue(e.currentTarget.value,);
                                    setHeaderPadding(v,);
                                    e.currentTarget.value = v;
                                }}
                                placeholder="0px"
                            />
                            <Tooltip
                                content="Valid CSS values: px, em, rem, vw, %, or shorthand like '8px 16px'. Plain numbers will auto-append px."
                                header="Padding"
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="site-header-editor__label">Margin</label>
                            <input
                                type="text"
                                class="site-header-editor__input--sm"
                                value={headerMargin()}
                                onInput={(e,) => {
                                    setHeaderMargin(e.currentTarget.value,);
                                    markDirty();
                                }}
                                onBlur={(e,) => {
                                    const v = normalizeCssValue(e.currentTarget.value,);
                                    setHeaderMargin(v,);
                                    e.currentTarget.value = v;
                                }}
                                placeholder="0px"
                            />
                            <Tooltip
                                content="Valid CSS values: px, em, rem, vw, %, auto, or shorthand like '0 auto'. Plain numbers will auto-append px."
                                header="Margin"
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="site-header-editor__label">Item Spacing</label>
                            <input
                                type="text"
                                class="site-header-editor__input--sm"
                                value={itemSpacing()}
                                onInput={(e,) => {
                                    setItemSpacing(e.currentTarget.value,);
                                    markDirty();
                                }}
                                onBlur={(e,) => {
                                    const v = normalizeCssValue(e.currentTarget.value,);
                                    setItemSpacing(v,);
                                    e.currentTarget.value = v;
                                }}
                                placeholder="0"
                            />
                            <Tooltip
                                content="CSS gap between header items. Valid values: px, em, rem, vw. Plain numbers will auto-append px. Use 0 for no spacing."
                                header="Item Spacing"
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={applyGutter()}
                                    onChange={(e,) => {
                                        setApplyGutter(e.currentTarget.checked,);
                                        markDirty();
                                    }}
                                />
                                <span>Apply Site Gutter</span>
                            </label>
                        </div>
                        <div class="site-header-editor__field">
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={sticky()}
                                    onChange={(e,) => {
                                        setSticky(e.currentTarget.checked,);
                                        markDirty();
                                    }}
                                />
                                <span>Make header sticky</span>
                            </label>
                            <Tooltip
                                header="Sticky header"
                                content="Pins the site header to the top of the viewport so it stays visible as visitors scroll. Turn off to let the header scroll away with the page like any other section."
                            />
                        </div>
                        <div class="site-header-editor__field">
                            <label class="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={autoHide()}
                                    onChange={(e,) => {
                                        setAutoHide(e.currentTarget.checked,);
                                        markDirty();
                                    }}
                                />
                                <span>Auto-hide on scroll</span>
                            </label>
                            <Tooltip
                                header="Auto-hide"
                                content="Slides the header up out of view when the visitor scrolls down, and slides it back into place when they scroll up. Combine with 'Make header sticky' for the typical content-priority pattern; without sticky the header is already in flow so this is a no-op."
                            />
                        </div>
                        <div class="site-header-editor__settings-actions">
                            <button
                                class="btn btn--primary btn--small"
                                disabled={!isDirty() || saving()}
                                onClick={handleSave}
                            >
                                {saving() ? 'Saving...' : 'Save Header'}
                            </button>
                            <button
                                class="btn btn--secondary btn--small"
                                onClick={() => setShowSettings(false,)}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </Show>

                {/* ─── Edit panel ─── */}
                <Show when={editItem()}>
                    {(item,) => {
                        const currentType = () => item().type;
                        return (
                            <div class="site-header-edit-panel">
                                {/* Button bar */}
                                <div class="site-header-edit-panel__actions">
                                    <button class="btn btn--primary btn--small" onClick={handleSaveItem}>
                                        Save Item
                                    </button>
                                    <button class="btn btn--secondary btn--small" onClick={handleCancelEdit}>
                                        Cancel
                                    </button>
                                    <div class="site-header-edit-panel__spacer" />
                                    <button class="btn btn--ghost btn--small" onClick={handleResetItem}>
                                        Reset Item
                                    </button>
                                </div>

                                {/* Type dropdown */}
                                <div class="site-header-edit-panel__field">
                                    <label class="site-header-edit-panel__label">Type</label>
                                    <select
                                        class="site-header-edit-panel__select"
                                        value={item().type}
                                        onChange={(e,) =>
                                            updateEditField('type', e.currentTarget.value as HeaderItemType,)}
                                    >
                                        <For each={HEADER_ITEM_TYPES}>
                                            {(opt,) => <option value={opt.value}>{opt.label}</option>}
                                        </For>
                                    </select>
                                </div>

                                {/* Image select/upload */}
                                <Show when={needsImage(currentType(),)}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Image</label>
                                        <Show when={item().imageUrl}>
                                            <div class="site-header-edit-panel__image-preview">
                                                <img src={item().imageUrl} alt="" />
                                            </div>
                                        </Show>
                                        <div class="site-header-edit-panel__btn-row">
                                            <button
                                                class="btn btn--secondary btn--small"
                                                onClick={() => setShowMediaSelect(true,)}
                                            >
                                                Select Media
                                            </button>
                                            <button
                                                class="btn btn--outline btn--small"
                                                onClick={() => setShowMediaUpload(true,)}
                                            >
                                                Upload New
                                            </button>
                                            <Show when={item().imageUrl}>
                                                <button
                                                    class="btn btn--danger btn--small"
                                                    onClick={() => {
                                                        updateEditField('imageUrl', undefined,);
                                                        updateEditField('mediaId', undefined,);
                                                    }}
                                                    title="Remove image"
                                                >
                                                    &times;
                                                </button>
                                            </Show>
                                        </div>
                                    </div>
                                </Show>

                                {/* Text input */}
                                <Show when={needsText(currentType(),)}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Text</label>
                                        <input
                                            type="text"
                                            class="site-header-edit-panel__input"
                                            value={item().text || ''}
                                            onInput={(e,) => updateEditField('text', e.currentTarget.value,)}
                                            placeholder="Link text"
                                        />
                                    </div>
                                </Show>

                                {/* URL input */}
                                <Show when={needsUrl(currentType(),)}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">URL</label>
                                        <input
                                            type="text"
                                            class="site-header-edit-panel__input"
                                            value={item().url || ''}
                                            onInput={(e,) => updateEditField('url', e.currentTarget.value,)}
                                            placeholder="/"
                                        />
                                    </div>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__toggle">
                                            <input
                                                type="checkbox"
                                                checked={item().openInNewTab || false}
                                                onChange={(e,) =>
                                                    updateEditField('openInNewTab', e.currentTarget.checked,)}
                                            />
                                            <span>Open in new tab</span>
                                        </label>
                                    </div>
                                </Show>

                                {/* Button color */}
                                <Show when={needsButtonColor(currentType(),)}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Button Color</label>
                                        <ColorPicker
                                            value={item().buttonColor || '#333333'}
                                            onChange={(hex,) => updateEditField('buttonColor', hex,)}
                                        />
                                    </div>
                                </Show>

                                {/* Gap width */}
                                <Show when={currentType() === 'gap'}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Width</label>
                                        <input
                                            type="text"
                                            class="site-header-edit-panel__input site-header-edit-panel__input--short"
                                            value={item().width || '20px'}
                                            onInput={(e,) => updateEditField('width', e.currentTarget.value,)}
                                            placeholder="20px"
                                        />
                                    </div>
                                </Show>

                                {/* Flex spacer optional width */}
                                <Show when={currentType() === 'flex_spacer'}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Max Width (optional)</label>
                                        <input
                                            type="text"
                                            class="site-header-edit-panel__input site-header-edit-panel__input--short"
                                            value={item().width || ''}
                                            onInput={(e,) => updateEditField('width', e.currentTarget.value,)}
                                            placeholder="e.g. 200px or leave empty"
                                        />
                                    </div>
                                </Show>

                                {/* Common style fields */}
                                <Show when={needsCommonStyles(currentType(),)}>
                                    {/* Font Size */}
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Font Size</label>
                                        <select
                                            class="site-header-edit-panel__select"
                                            value={item().fontSize || '16px'}
                                            onChange={(e,) => updateEditField('fontSize', e.currentTarget.value,)}
                                        >
                                            <For each={FONT_SIZE_OPTIONS}>
                                                {(size,) => <option value={size}>{size}</option>}
                                            </For>
                                        </select>
                                    </div>

                                    {/* Font Weight */}
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Font Weight</label>
                                        <select
                                            class="site-header-edit-panel__select"
                                            value={item().fontWeight || ''}
                                            onChange={(e,) => updateEditField('fontWeight', e.currentTarget.value,)}
                                        >
                                            <For each={FONT_WEIGHT_OPTIONS}>
                                                {(opt,) => <option value={opt.value}>{opt.label}</option>}
                                            </For>
                                        </select>
                                    </div>

                                    {/* Text Color */}
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Text Color</label>
                                        <ColorPicker
                                            value={item().textColor || '#000000'}
                                            onChange={(hex,) => updateEditField('textColor', hex,)}
                                        />
                                    </div>

                                    {/* Horizontal Alignment */}
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Horizontal Alignment</label>
                                        <select
                                            class="site-header-edit-panel__select"
                                            value={item().alignment || 'center'}
                                            onChange={(e,) => updateEditField('alignment', e.currentTarget.value,)}
                                        >
                                            <option value="left">Left</option>
                                            <option value="center">Center</option>
                                            <option value="right">Right</option>
                                        </select>
                                    </div>

                                    {/* Vertical Alignment */}
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Vertical Alignment</label>
                                        <select
                                            class="site-header-edit-panel__select"
                                            value={item().verticalAlignment || 'center'}
                                            onChange={(e,) => updateEditField('verticalAlignment', e.currentTarget.value,)}
                                        >
                                            <option value="top">Top</option>
                                            <option value="center">Center</option>
                                            <option value="bottom">Bottom</option>
                                        </select>
                                    </div>
                                </Show>

                                {/* Width (all types) */}
                                <Show when={currentType() !== 'gap' && currentType() !== 'flex_spacer'}>
                                    <div class="site-header-edit-panel__field">
                                        <label class="site-header-edit-panel__label">Width</label>
                                        <div class="site-header-edit-panel__field-right">
                                            <Show
                                                when={!customWidth()}
                                                fallback={
                                                    <div class="site-header-edit-panel__custom-input-row">
                                                        <input
                                                            type="text"
                                                            class="site-header-edit-panel__input site-header-edit-panel__input--short"
                                                            value={item().width || ''}
                                                            onInput={(e,) =>
                                                                updateEditField('width', e.currentTarget.value,)}
                                                            placeholder="e.g. 120px"
                                                        />
                                                        <Tooltip
                                                            content="Valid values: %, px, vw, rem, em, auto"
                                                            header="CSS Width"
                                                        />
                                                        <button
                                                            class="btn btn--small btn--ghost"
                                                            onClick={() => {
                                                                updateEditField('width', undefined,);
                                                                setCustomWidth(false,);
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                }
                                            >
                                                <div class="site-header-edit-panel__preset-row">
                                                    <select
                                                        class="site-header-edit-panel__select"
                                                        value={item().width || 'auto'}
                                                        onChange={(e,) =>
                                                            updateEditField('width', e.currentTarget.value,)}
                                                    >
                                                        <For each={WIDTH_OPTIONS}>
                                                            {(val,) => <option value={val}>{val}</option>}
                                                        </For>
                                                    </select>
                                                    <button
                                                        class="btn btn--small btn--link"
                                                        onClick={() => setCustomWidth(true,)}
                                                    >
                                                        Custom
                                                    </button>
                                                </div>
                                            </Show>
                                        </div>
                                    </div>
                                </Show>

                                {/* Margin */}
                                <div class="site-header-edit-panel__field">
                                    <label class="site-header-edit-panel__label">Margin</label>
                                    <div class="site-header-edit-panel__field-right">
                                        <Show
                                            when={!customMargin()}
                                            fallback={
                                                <div class="site-header-edit-panel__custom-input-row">
                                                    <input
                                                        type="text"
                                                        class="site-header-edit-panel__input site-header-edit-panel__input--short"
                                                        value={item().margin || ''}
                                                        onInput={(e,) =>
                                                            updateEditField('margin', e.currentTarget.value,)}
                                                        placeholder="e.g. 5px 10px"
                                                    />
                                                    <Tooltip
                                                        content="Valid values: px, rem, em, %, or shorthand like '5px 10px'"
                                                        header="CSS Margin"
                                                    />
                                                    <button
                                                        class="btn btn--small btn--ghost"
                                                        onClick={() => {
                                                            updateEditField('margin', undefined,);
                                                            setCustomMargin(false,);
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            }
                                        >
                                            <div class="site-header-edit-panel__preset-row">
                                                <select
                                                    class="site-header-edit-panel__select"
                                                    value={item().margin || '0px'}
                                                    onChange={(e,) => updateEditField('margin', e.currentTarget.value,)}
                                                >
                                                    <For each={MARGIN_OPTIONS}>
                                                        {(val,) => <option value={val}>{val}</option>}
                                                    </For>
                                                </select>
                                                <button
                                                    class="btn btn--small btn--link"
                                                    onClick={() => setCustomMargin(true,)}
                                                >
                                                    Custom
                                                </button>
                                            </div>
                                        </Show>
                                    </div>
                                </div>

                                {/* Padding */}
                                <div class="site-header-edit-panel__field">
                                    <label class="site-header-edit-panel__label">Padding</label>
                                    <div class="site-header-edit-panel__field-right">
                                        <Show
                                            when={!customPadding()}
                                            fallback={
                                                <div class="site-header-edit-panel__custom-input-row">
                                                    <input
                                                        type="text"
                                                        class="site-header-edit-panel__input site-header-edit-panel__input--short"
                                                        value={item().padding || ''}
                                                        onInput={(e,) =>
                                                            updateEditField('padding', e.currentTarget.value,)}
                                                        placeholder="e.g. 5px 10px"
                                                    />
                                                    <Tooltip
                                                        content="Valid values: px, rem, em, %, or shorthand like '5px 10px'"
                                                        header="CSS Padding"
                                                    />
                                                    <button
                                                        class="btn btn--small btn--ghost"
                                                        onClick={() => {
                                                            updateEditField('padding', undefined,);
                                                            setCustomPadding(false,);
                                                        }}
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            }
                                        >
                                            <div class="site-header-edit-panel__preset-row">
                                                <select
                                                    class="site-header-edit-panel__select"
                                                    value={item().padding || '0px'}
                                                    onChange={(e,) =>
                                                        updateEditField('padding', e.currentTarget.value,)}
                                                >
                                                    <For each={PADDING_OPTIONS}>
                                                        {(val,) => <option value={val}>{val}</option>}
                                                    </For>
                                                </select>
                                                <button
                                                    class="btn btn--small btn--link"
                                                    onClick={() => setCustomPadding(true,)}
                                                >
                                                    Custom
                                                </button>
                                            </div>
                                        </Show>
                                    </div>
                                </div>
                            </div>
                        );
                    }}
                </Show>
            </Show>

            {/* ─── Modals ─── */}
            <Show when={showMediaSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={handleMediaSelect}
                    onClose={() => setShowMediaSelect(false,)}
                />
            </Show>
            <Show when={showMediaUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={handleMediaUpload}
                    onClose={() => setShowMediaUpload(false,)}
                />
            </Show>
        </div>
    );
};

export default SiteHeaderEditor;
