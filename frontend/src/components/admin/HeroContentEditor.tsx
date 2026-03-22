import { Component, createSignal, createEffect, createMemo, For, Show, onMount } from 'solid-js';
import { fetchHeroSettings, saveHeroSettings } from '../../services/api';
import type { HeroItem, HeroCarouselOptions, HeroCarouselSettings, HeroTextConfig, HeroActionConfig } from '@surge/shared';
import HeroCarousel from '../HeroCarousel';
import ColorPicker from './ColorPicker';
import MediaSelectModal from './MediaSelectModal';
import MediaUploadModal from './MediaUploadModal';
import Tooltip from './Tooltip';
import './HeroContentEditor.scss';

const genId = () => 'hero-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

const isValidHeight = (v: string) => /^\d+(px|vw|vh|%)$/.test(v);

const OBJECT_FIT_OPTIONS: HeroItem['objectFit'][] = ['cover', 'contain', 'fill', 'none', 'scale-down'];
const HEADING_SIZES: HeroTextConfig['size'][] = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

const DEFAULT_OPTIONS: HeroCarouselOptions = {
  autoScroll: false,
  autoScrollInterval: 3000,
  repeat: true,
  customHeight: false,
  height: '50vh',
};

const HeroContentEditor: Component = () => {
  const [items, setItems] = createSignal<HeroItem[]>([]);
  const [options, setOptions] = createSignal<HeroCarouselOptions>({ ...DEFAULT_OPTIONS });
  const [isDirty, setIsDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [showMediaSelect, setShowMediaSelect] = createSignal(false);
  const [showMediaUpload, setShowMediaUpload] = createSignal(false);

  // Drag state
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [ghostStyle, setGhostStyle] = createSignal<{ top: number; left: number; width: number; height: number } | null>(null);

  onMount(async () => {
    try {
      const res = await fetchHeroSettings();
      if (res.success && res.data) {
        const data = res.data as HeroCarouselSettings;
        if (data.items?.length) {
          setItems(data.items.sort((a, b) => a.order - b.order));
        }
        if (data.options) {
          setOptions({ ...DEFAULT_OPTIONS, ...data.options });
        }
      }
    } catch (e) {
      console.error('Failed to load hero settings:', e);
    } finally {
      setLoading(false);
    }
  });

  const markDirty = () => setIsDirty(true);

  // ─── Item CRUD ───

  const updateItem = (id: string, updater: (item: HeroItem) => HeroItem) => {
    setItems(prev => prev.map(item => item.id === id ? updater(item) : item));
    markDirty();
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id).map((item, i) => ({ ...item, order: i })));
    markDirty();
  };

  const addItemFromMedia = (media: { id: string; url: string; thumbnailUrl?: string; mimeType: string }) => {
    const mediaType: HeroItem['mediaType'] = media.mimeType.startsWith('video/') ? 'video' : 'image';
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
    setItems(prev => [...prev, newItem]);
    markDirty();
  };

  // ─── Options update ───

  const updateOptions = (patch: Partial<HeroCarouselOptions>) => {
    setOptions(prev => ({ ...prev, ...patch }));
    markDirty();
  };

  // ─── Save ───

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: HeroCarouselSettings = {
        items: items().map((item, i) => ({ ...item, order: i })),
        options: options(),
      };
      const res = await saveHeroSettings(payload);
      if (res.success) {
        setIsDirty(false);
        alert('Hero settings saved successfully.');
      } else {
        alert('Failed to save: ' + ((res as any).error?.message || 'Unknown error'));
      }
    } catch (e) {
      alert('Failed to save hero settings.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  // ─── Drag reorder (horizontal) ───

  const handleDragStart = (e: PointerEvent, id: string) => {
    const cardEl = (e.target as HTMLElement).closest('.hero-item-card') as HTMLElement;
    if (!cardEl) return;

    e.preventDefault();
    const rect = cardEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    setDraggingId(id);
    setGhostStyle({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });

    const listEl = cardEl.parentElement;
    let currentItems = [...items()];
    let currentIndex = currentItems.findIndex(item => item.id === id);

    const handleMove = (moveEvt: PointerEvent) => {
      moveEvt.preventDefault();
      setGhostStyle(prev => prev ? {
        ...prev,
        top: moveEvt.clientY - offsetY,
        left: moveEvt.clientX - offsetX,
      } : null);

      if (!listEl) return;
      const cardEls = Array.from(listEl.querySelectorAll('.hero-item-card')) as HTMLElement[];
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
      newIndex = Math.max(0, Math.min(currentItems.length - 1, newIndex > currentIndex ? newIndex - 1 : newIndex));

      if (newIndex !== currentIndex) {
        const arr = [...currentItems];
        const [item] = arr.splice(currentIndex, 1);
        arr.splice(newIndex, 0, item);
        currentItems = arr;
        currentIndex = newIndex;
        setItems(arr.map((it, i) => ({ ...it, order: i })));
        markDirty();
      }
    };

    const handleUp = () => {
      setDraggingId(null);
      setGhostStyle(null);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  };

  // ─── Preview height scaling ───

  const scaledHeight = createMemo(() => {
    const h = options().customHeight && options().height ? options().height : '50vh';
    const match = h.match(/^(\d+)(px|vw|vh|%)$/);
    if (!match) return '200px';
    const value = parseInt(match[1]);
    const unit = match[2];
    const scale = 0.65;
    return `${Math.round(value * scale)}${unit}`;
  });

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
                  [field]: { text: '', size: field === 'header' ? 'h1' : 'h3', color: '#ffffff' } as HeroTextConfig,
                }));
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
                  const updated = { ...it };
                  delete (updated as any)[field];
                  return updated;
                });
              }}
            >
              Remove
            </button>
          </div>
          <textarea
            rows={2}
            class="input input--sm"
            placeholder={`${label} text...`}
            value={config?.text || ''}
            onInput={(e) => {
              updateItem(item.id, it => ({
                ...it,
                [field]: { ...it[field]!, text: e.currentTarget.value },
              }));
            }}
          />
          <div class="hero-item-card__row">
            <select
              class="input input--sm input--select"
              value={config?.size || 'h1'}
              onChange={(e) => {
                updateItem(item.id, it => ({
                  ...it,
                  [field]: { ...it[field]!, size: e.currentTarget.value as HeroTextConfig['size'] },
                }));
              }}
            >
              <For each={HEADING_SIZES}>
                {(size) => <option value={size}>{size.toUpperCase()}</option>}
              </For>
            </select>
            <ColorPicker
              value={config?.color || '#ffffff'}
              onChange={(color) => {
                updateItem(item.id, it => ({
                  ...it,
                  [field]: { ...it[field]!, color },
                }));
              }}
            />
          </div>
        </Show>
      </div>
    );
  };

  const renderActionSection = (item: HeroItem) => {
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
                  action: { label: '', url: '', openInNewTab: false } as HeroActionConfig,
                }));
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
                  const updated = { ...it };
                  delete updated.action;
                  return updated;
                });
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
            onInput={(e) => {
              updateItem(item.id, it => ({
                ...it,
                action: { ...it.action!, label: e.currentTarget.value },
              }));
            }}
          />
          <input
            type="text"
            class="input input--sm"
            placeholder="URL (e.g. /donate)"
            value={action?.url || ''}
            onInput={(e) => {
              updateItem(item.id, it => ({
                ...it,
                action: { ...it.action!, url: e.currentTarget.value },
              }));
            }}
          />
          <label class="hero-item-card__toggle">
            <input
              type="checkbox"
              checked={action?.openInNewTab || false}
              onChange={(e) => {
                updateItem(item.id, it => ({
                  ...it,
                  action: { ...it.action!, openInNewTab: e.currentTarget.checked },
                }));
              }}
            />
            <span>Open in new tab</span>
          </label>
        </Show>
      </div>
    );
  };

  // ─── Main render ───

  return (
    <div class="hero-editor">
      <div class="hero-editor__header">
        <h2>Hero Content</h2>
        <button
          class="btn btn--primary"
          disabled={!isDirty() || saving()}
          onClick={handleSave}
        >
          {saving() ? 'Saving...' : 'Save'}
        </button>
      </div>

      <Show when={loading()}>
        <div class="hero-editor__loading">Loading hero settings...</div>
      </Show>

      <Show when={!loading()}>
        {/* ─── Item Cards ─── */}
        <div class={`hero-editor__items ${draggingId() ? 'hero-editor__items--dragging' : ''}`}>
          <For each={items()}>
            {(item) => (
              <div
                class={`hero-item-card ${draggingId() === item.id ? 'hero-item-card--dragging' : ''}`}
              >
                {/* Media preview */}
                <div class="hero-item-card__preview">
                  <Show
                    when={item.mediaType === 'video'}
                    fallback={
                      <img
                        src={item.mediaThumbnailUrl || item.mediaUrl}
                        alt=""
                        style={{ 'object-fit': item.objectFit || 'cover' }}
                      />
                    }
                  >
                    <video
                      src={item.mediaUrl}
                      poster={item.mediaThumbnailUrl}
                      controls
                      muted
                      playsinline
                      style={{ 'object-fit': item.objectFit || 'cover' }}
                    />
                  </Show>
                </div>

                <div class="hero-item-card__body">
                  {/* Object fit */}
                  <div class="hero-item-card__field">
                    <label class="hero-item-card__field-label">Object Fit</label>
                    <select
                      class="input input--sm input--select"
                      value={item.objectFit || 'cover'}
                      onChange={(e) => {
                        updateItem(item.id, it => ({
                          ...it,
                          objectFit: e.currentTarget.value as HeroItem['objectFit'],
                        }));
                      }}
                    >
                      <For each={OBJECT_FIT_OPTIONS}>
                        {(opt) => <option value={opt}>{opt}</option>}
                      </For>
                    </select>
                  </div>

                  {/* Autoplay (video only) */}
                  <Show when={item.mediaType === 'video'}>
                    <label class="hero-item-card__toggle">
                      <input
                        type="checkbox"
                        checked={item.autoplay ?? true}
                        onChange={(e) => {
                          updateItem(item.id, it => ({
                            ...it,
                            autoplay: e.currentTarget.checked,
                          }));
                        }}
                      />
                      <span>Autoplay</span>
                    </label>
                  </Show>

                  {/* Header */}
                  {renderTextSection(item, 'header', 'Header')}

                  {/* Subheader */}
                  {renderTextSection(item, 'subheader', 'Subheader')}

                  {/* Action */}
                  {renderActionSection(item)}
                </div>

                {/* Footer: drag + delete */}
                <div class="hero-item-card__footer">
                  <button
                    class="hero-item-card__drag-handle"
                    onPointerDown={(e) => handleDragStart(e, item.id)}
                    title="Drag to reorder"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
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
                      if (confirm('Remove this hero item?')) {
                        removeItem(item.id);
                      }
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
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
                onClick={() => setShowMediaSelect(true)}
              >
                Select Existing Media
              </button>
              <button
                class="btn btn--sm btn--outline"
                onClick={() => setShowMediaUpload(true)}
              >
                Upload New Media
              </button>
            </div>
          </div>
        </div>

        {/* Drag ghost */}
        <Show when={ghostStyle()}>
          {(style) => (
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
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
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

        {/* ─── Carousel Options ─── */}
        <div class="hero-options">
          <h3 class="hero-options__title">Carousel Options</h3>
          <div class="hero-options__row">
            {/* Auto-scroll */}
            <div class="hero-options__group">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  checked={options().autoScroll}
                  disabled={items().length <= 1}
                  onChange={(e) => updateOptions({ autoScroll: e.currentTarget.checked })}
                />
                <span class="toggle-switch__slider" />
              </label>
              <span class="hero-options__label">Auto-scroll</span>
              <Show when={options().autoScroll}>
                <input
                  type="number"
                  class="input input--sm input--inline-number"
                  min={500}
                  step={500}
                  value={options().autoScrollInterval}
                  onInput={(e) => {
                    const val = parseInt(e.currentTarget.value);
                    if (!isNaN(val) && val >= 500) {
                      updateOptions({ autoScrollInterval: val });
                    }
                  }}
                />
                <span class="hero-options__unit">ms</span>
              </Show>
            </div>

            {/* Repeat */}
            <div class="hero-options__group">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  checked={options().repeat}
                  disabled={items().length <= 1}
                  onChange={(e) => updateOptions({ repeat: e.currentTarget.checked })}
                />
                <span class="toggle-switch__slider" />
              </label>
              <span class="hero-options__label">Repeat</span>
            </div>

            {/* Custom height */}
            <div class="hero-options__group">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  checked={options().customHeight}
                  onChange={(e) => updateOptions({ customHeight: e.currentTarget.checked })}
                />
                <span class="toggle-switch__slider" />
              </label>
              <span class="hero-options__label">Custom height</span>
              <Show when={options().customHeight}>
                <input
                  type="text"
                  class={`input input--sm input--inline-text ${!isValidHeight(options().height || '') ? 'input--error' : ''}`}
                  placeholder="50vh"
                  value={options().height || ''}
                  onInput={(e) => updateOptions({ height: e.currentTarget.value })}
                />
              </Show>
              <Tooltip
                header="Height Values"
                content={
                  <div>
                    <p><code>px</code> — Fixed pixel height (e.g. <code>600px</code>). Stays the same size on all screens.</p>
                    <p><code>vh</code> — Percentage of viewport height (e.g. <code>50vh</code> = half the screen). Scales with the browser window height.</p>
                    <p><code>vw</code> — Percentage of viewport width (e.g. <code>30vw</code>). Scales with the browser window width — useful for maintaining aspect ratio.</p>
                    <p><code>%</code> — Percentage of the parent container (e.g. <code>50%</code>). Relative to the element the hero sits inside.</p>
                  </div>
                }
              />
            </div>
          </div>
        </div>

        {/* ─── Preview ─── */}
        <div class="hero-preview">
          <h3 class="hero-preview__title">Preview</h3>
          <Show
            when={items().length > 0}
            fallback={
              <div class="hero-preview__empty">
                Add hero items above to see a preview
              </div>
            }
          >
            <div class="hero-preview__container">
              <HeroCarousel
                items={items()}
                options={options()}
                previewMode={true}
                height={scaledHeight()}
              />
            </div>
          </Show>
        </div>
      </Show>

      {/* ─── Modals ─── */}
      <Show when={showMediaSelect()}>
        <MediaSelectModal
          types={['image', 'video']}
          onSelect={(media) => {
            addItemFromMedia({
              id: media.id,
              url: media.url,
              thumbnailUrl: media.thumbnailUrl,
              mimeType: media.mimeType,
            });
            setShowMediaSelect(false);
          }}
          onClose={() => setShowMediaSelect(false)}
        />
      </Show>

      <Show when={showMediaUpload()}>
        <MediaUploadModal
          acceptTypes="image/*,video/*"
          onUploaded={(media) => {
            addItemFromMedia({
              id: media.id,
              url: media.url,
              thumbnailUrl: media.thumbnailUrl,
              mimeType: media.mimeType,
            });
            setShowMediaUpload(false);
          }}
          onClose={() => setShowMediaUpload(false)}
        />
      </Show>
    </div>
  );
};

export default HeroContentEditor;
