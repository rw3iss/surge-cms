/**
 * Gallery block editor. Source: hand-picked items (the shared
 * EntitySearchSelectModal on the read-only `gallery_item` entity type,
 * multiple mode) or a live query (the same modal's "Configure query", mapped
 * to a GalleryQuery: type / tag / sort / search + limit). Layout per
 * breakpoint (Desktop / Mobile ≤768px — an empty mobile value follows
 * desktop) + behaviour, modelled on the Carousel block's options.
 *
 * Text/number inputs commit on `change` (blur / Enter), never per keystroke.
 */
import type {
    EntityQuery, EntityRecord, GalleryBlockLayout, GalleryBlockLayoutOptions, GalleryBlockSettings, GalleryItem,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../../stores/siteSettings';
import { gallerySettingsOf, } from '../../../blocks/types/GalleryBlock';
import { entityQueryToGalleryQuery, galleryQueryToEntityQuery, } from '../../../gallery/galleryLayout';
import { tileSrc, } from '../../../gallery/GalleryTile';
import EntitySearchSelectModal from '../../entities/EntitySearchSelectModal';
import Toggle from '../../common/Toggle';
import { FormField, } from '../../forms';
import './GalleryBlockEdit.scss';

const LAYOUTS: { value: GalleryBlockLayout; label: string; }[] = [
    { value: 'grid', label: 'Grid', },
    { value: 'row', label: 'Row (horizontal carousel)', },
    { value: 'column', label: 'Column (vertical list)', },
    { value: 'carousel', label: 'Carousel (one at a time)', },
    { value: 'stage', label: 'Stage (large + thumbnails)', },
];

const GalleryBlockEdit: Component<{
    data: Record<string, any>;
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    const s = () => gallerySettingsOf(props.data,);
    const set = (patch: Partial<GalleryBlockSettings>,) => props.onUpdate({ ...props.data, ...s(), ...patch, },);
    const [bp, setBp,] = createSignal<'desktop' | 'mobile'>('desktop',);
    const [modal, setModal,] = createSignal<'multiple' | 'query' | null>(null,);

    const opts = (): GalleryBlockLayoutOptions => (bp() === 'desktop' ? s().desktop : s().mobile) ?? {};
    const setOpt = (patch: Partial<GalleryBlockLayoutOptions>,) => {
        const key = bp();
        const next = { ...(s()[key] ?? {}), ...patch, };
        for (const k of Object.keys(next,) as (keyof GalleryBlockLayoutOptions)[]) {
            if (next[k] === undefined || next[k] === '' || (typeof next[k] === 'number' && Number.isNaN(next[k],))) delete next[k];
        }
        set({ [key]: next, } as Partial<GalleryBlockSettings>,);
    };
    /** Effective layout (mobile falls back to desktop) — decides which controls show. */
    const layout = (): GalleryBlockLayout => (bp() === 'mobile' && s().mobile?.layout) || s().desktop?.layout || 'grid';
    const isPaged = () => ['row', 'carousel', 'column',].includes(layout(),);
    /** Placeholder on mobile = the desktop value it falls back to. */
    const ph = (k: keyof GalleryBlockLayoutOptions, fallback = '',) => (bp() === 'mobile' ? `= desktop (${s().desktop?.[k] ?? fallback})` : fallback);
    const num = (v: string,) => (v.trim() === '' ? undefined : Math.max(1, Math.round(Number(v,),),));

    // Picked items (thumbnails + order).
    const [picked, { refetch, },] = createResource(
        () => (s().source === 'items' && (s().itemIds ?? []).length ? (s().itemIds ?? []).join(',',) : null),
        async (key,) => {
            try {
                return (await cms.gallery.list({ ids: key.split(',',), limit: 200, },)).items;
            } catch {
                return [] as GalleryItem[];
            }
        },
    );
    const move = (id: string, d: number,) => {
        const ids = [...(s().itemIds ?? []),];
        const i = ids.indexOf(id,);
        const j = i + d;
        if (i < 0 || j < 0 || j >= ids.length) return;
        [ids[i], ids[j],] = [ids[j]!, ids[i]!,];
        set({ itemIds: ids, },);
    };
    const removeItem = (id: string,) => set({ itemIds: (s().itemIds ?? []).filter((x,) => x !== id,), },);
    const byId = (id: string,) => picked()?.find((p,) => p.id === id,);

    const querySummary = () => {
        const q = s().query ?? {};
        const parts = [
            q.type && q.type !== 'all' ? `${q.type}s` : 'all media',
            q.tag ? `tag ${q.tag}` : '',
            q.search ? `“${q.search}”` : '',
            `sorted by ${q.sort ?? 'gallery order'}`,
            `up to ${q.limit ?? 12}`,
        ].filter(Boolean,);
        return parts.join(' · ',);
    };

    return (
        <div class="gallery-block-edit">
            <Show when={!isFeatureEnabled('gallery',)}>
                <div class="alert alert--warning">The Gallery feature is off — this block shows nothing until it is enabled in Settings → Features.</div>
            </Show>

            <FormField label="Source" tooltip="Pick specific gallery items, or run a live query (newest images, a tag, …) that updates as the gallery changes.">
                <select value={s().source} onChange={(e,) => set({ source: e.currentTarget.value as GalleryBlockSettings['source'], },)}>
                    <option value="query">Query (live)</option>
                    <option value="items">Selected items</option>
                </select>
            </FormField>

            <Show
                when={s().source === 'items'}
                fallback={
                    <div class="gallery-block-edit__source">
                        <p class="gallery-block-edit__summary">{querySummary()}</p>
                        <div class="gallery-block-edit__row">
                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setModal('query',)}>Configure query…</button>
                            <FormField label="Limit" inline>
                                <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={s().query?.limit ?? 12}
                                    onChange={(e,) => set({ query: { ...(s().query ?? {}), limit: num(e.currentTarget.value,) ?? 12, }, },)}
                                />
                            </FormField>
                        </div>
                    </div>
                }
            >
                <div class="gallery-block-edit__source">
                    <div class="gallery-block-edit__picked">
                        <For each={s().itemIds ?? []} fallback={<p class="form-help-muted">No items selected.</p>}>
                            {(id, i,) => (
                                <div class="gallery-block-edit__chip" title={byId(id,)?.title || id}>
                                    <Show when={byId(id,)} fallback={<span class="gallery-block-edit__missing">Unavailable</span>}>
                                        {(it,) => <img src={tileSrc(it(),)} alt="" />}
                                    </Show>
                                    <div class="gallery-block-edit__chip-actions">
                                        <button type="button" disabled={i() === 0} aria-label="Move left" onClick={() => move(id, -1,)}>‹</button>
                                        <button type="button" aria-label="Remove" onClick={() => removeItem(id,)}>×</button>
                                        <button type="button" disabled={i() === (s().itemIds ?? []).length - 1} aria-label="Move right" onClick={() => move(id, 1,)}>›</button>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                    <div class="gallery-block-edit__row">
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setModal('multiple',)}>
                            {(s().itemIds ?? []).length ? 'Change items…' : 'Select items…'}
                        </button>
                        <A href="/admin/gallery" class="form-help-muted">Manage the gallery</A>
                    </div>
                </div>
            </Show>

            <div class="gallery-block-edit__bp" role="tablist" aria-label="Breakpoint">
                <button type="button" classList={{ 'is-active': bp() === 'desktop', }} onClick={() => setBp('desktop',)}>Desktop</button>
                <button type="button" classList={{ 'is-active': bp() === 'mobile', }} onClick={() => setBp('mobile',)}>Mobile (≤768px)</button>
            </div>
            <Show when={bp() === 'mobile'}>
                <p class="form-help-muted gallery-block-edit__bp-hint">Empty fields follow the desktop value.</p>
            </Show>

            <div class="gallery-block-edit__grid">
                <FormField label="Layout">
                    <select value={opts().layout ?? ''} onChange={(e,) => setOpt({ layout: (e.currentTarget.value || undefined) as GalleryBlockLayout | undefined, },)}>
                        <Show when={bp() === 'mobile'}><option value="">= desktop</option></Show>
                        <For each={LAYOUTS}>{(l,) => <option value={l.value}>{l.label}</option>}</For>
                    </select>
                </FormField>
                <Show when={layout() === 'grid'}>
                    <FormField label="Columns" tooltip="Empty = as many as fit at a ~220px width.">
                        <input type="number" min={1} max={12} value={opts().columns ?? ''} placeholder={ph('columns', 'auto',)} onChange={(e,) => setOpt({ columns: num(e.currentTarget.value,), },)} />
                    </FormField>
                </Show>
                <Show when={layout() === 'row'}>
                    <FormField label="Items per page">
                        <input type="number" min={1} max={12} value={opts().itemsPerPage ?? ''} placeholder={ph('itemsPerPage', '3',)} onChange={(e,) => setOpt({ itemsPerPage: num(e.currentTarget.value,), },)} />
                    </FormField>
                    <FormField label="Scroll by" tooltip="Items advanced per arrow click / swipe / autoplay step.">
                        <input type="number" min={1} max={12} value={opts().scrollBy ?? ''} placeholder={ph('scrollBy', '1',)} onChange={(e,) => setOpt({ scrollBy: num(e.currentTarget.value,), },)} />
                    </FormField>
                </Show>
                <Show when={layout() === 'grid' || layout() === 'column'}>
                    <FormField label="Rows per page" tooltip="Pages the items (arrows + dots). Empty = show all.">
                        <input type="number" min={1} max={50} value={opts().rows ?? ''} placeholder={ph('rows', 'all',)} onChange={(e,) => setOpt({ rows: num(e.currentTarget.value,), },)} />
                    </FormField>
                </Show>
                <FormField label="Gap">
                    <input type="text" value={opts().gap ?? ''} placeholder={ph('gap', '12px',)} onChange={(e,) => setOpt({ gap: e.currentTarget.value.trim() || undefined, },)} />
                </FormField>
                <Show when={layout() === 'row'}>
                    <FormField label="Item width" tooltip="A fixed width per item (e.g. 280px) instead of fitting 'items per page'.">
                        <input type="text" value={opts().itemWidth ?? ''} placeholder={ph('itemWidth', 'auto',)} onChange={(e,) => setOpt({ itemWidth: e.currentTarget.value.trim() || undefined, },)} />
                    </FormField>
                </Show>
                <FormField label="Item height" tooltip="A fixed height (e.g. 240px). Overrides the aspect ratio.">
                    <input type="text" value={opts().itemHeight ?? ''} placeholder={ph('itemHeight', 'auto',)} onChange={(e,) => setOpt({ itemHeight: e.currentTarget.value.trim() || undefined, },)} />
                </FormField>
                <FormField label="Aspect">
                    <select value={opts().aspect ?? ''} onChange={(e,) => setOpt({ aspect: (e.currentTarget.value || undefined) as GalleryBlockLayoutOptions['aspect'], },)}>
                        <Show when={bp() === 'mobile'}><option value="">= desktop</option></Show>
                        <option value="square">Square</option>
                        <option value="4:3">4:3</option>
                        <option value="3:2">3:2</option>
                        <option value="16:9">16:9</option>
                        <option value="original">Original</option>
                    </select>
                </FormField>
                <FormField label="Fit">
                    <select value={opts().fit ?? ''} onChange={(e,) => setOpt({ fit: (e.currentTarget.value || undefined) as 'cover' | 'contain' | undefined, },)}>
                        <Show when={bp() === 'mobile'}><option value="">= desktop</option></Show>
                        <option value="cover">Fill (crop)</option>
                        <option value="contain">Fit (no crop)</option>
                    </select>
                </FormField>
            </div>

            <div class="gallery-block-edit__section-title">Behaviour</div>
            <div class="gallery-block-edit__toggles">
                <Show when={isPaged() || layout() === 'stage'}>
                    <Toggle checked={Boolean(s().autoplay,)} onChange={(v,) => set({ autoplay: v, },)} label="Auto-advance" />
                    <Show when={s().autoplay}>
                        <FormField label="Interval (seconds)" inline>
                            <input type="number" min={1} max={120} value={s().autoplayInterval ?? 5} onChange={(e,) => set({ autoplayInterval: num(e.currentTarget.value,) ?? 5, },)} />
                        </FormField>
                        <Toggle checked={s().pauseOnHover !== false} onChange={(v,) => set({ pauseOnHover: v, },)} label="Pause on hover" />
                    </Show>
                </Show>
                <Show when={isPaged() || layout() === 'grid'}>
                    <Toggle checked={s().loop !== false} onChange={(v,) => set({ loop: v, },)} label="Loop" />
                    <Toggle checked={s().showArrows !== false} onChange={(v,) => set({ showArrows: v, },)} label="Arrows" />
                    <Toggle checked={s().showDots !== false} onChange={(v,) => set({ showDots: v, },)} label="Dots" />
                </Show>
                <Toggle checked={Boolean(s().showTitles,)} onChange={(v,) => set({ showTitles: v, },)} label="Show titles" />
                <Toggle checked={Boolean(s().showCaptions,)} onChange={(v,) => set({ showCaptions: v, },)} label="Show captions" />
            </div>
            <div class="gallery-block-edit__grid">
                <FormField label="On click">
                    <select value={s().open ?? 'lightbox'} onChange={(e,) => set({ open: e.currentTarget.value as GalleryBlockSettings['open'], },)}>
                        <option value="lightbox">Open in a lightbox</option>
                        <option value="page">Go to the item's page</option>
                        <option value="none">Nothing</option>
                    </select>
                </FormField>
                <FormField label="Corner radius" tooltip="Empty = the site radius.">
                    <input type="text" value={s().radius ?? ''} placeholder="site" onChange={(e,) => set({ radius: e.currentTarget.value.trim() || undefined, },)} />
                </FormField>
            </div>

            <Show when={modal()}>
                <EntitySearchSelectModal
                    entityType="gallery_item"
                    mode={modal()!}
                    initialQuery={modal() === 'query' ? (galleryQueryToEntityQuery(s().query,) as EntityQuery) : undefined}
                    onClose={() => setModal(null,)}
                    onSelect={(result,) => {
                        if (modal() === 'multiple') {
                            const ids = (result as EntityRecord[]).map((r,) => String(r.id,),);
                            set({ source: 'items', itemIds: ids, },);
                            void refetch();
                        } else {
                            set({ source: 'query', query: entityQueryToGalleryQuery(result as EntityQuery, s().query?.limit,), },);
                        }
                        setModal(null,);
                    }}
                />
            </Show>
        </div>
    );
};

export default GalleryBlockEdit;
