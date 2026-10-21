/**
 * Gallery block editor. Source: **Data** — one "Set data…" (the shared
 * DataBindingField on the read-only `gallery_item` entity type): ticked items
 * save as `source:'items'` + `itemIds`, none ticked saves the filters as a
 * live `source:'query'` (mapped to a GalleryQuery: type / tag / sort / search
 * + limit) — or, inside a template, **Template data** (the gallery_item
 * record(s) the template renders; offered only when the template binds
 * `gallery_item`) or **Slot**. Layout per
 * breakpoint (Desktop / Mobile ≤768px — an empty mobile value follows
 * desktop) + behaviour, modelled on the Carousel block's options.
 *
 * Text/number inputs commit on `change` (blur / Enter), never per keystroke.
 */
import type {
    EntityQuery, GalleryBlockLayout, GalleryBlockLayoutOptions, GalleryBlockSettings, GalleryFit, GalleryItem, GalleryTitlePosition, SlotBinding,
} from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../../stores/siteSettings';
import { templateInfo, templateSlots, } from '../../../../stores/templateSlots';
import { slotChoices, slotOptionLabel, templateDataSourceState, } from '../../../../utils/templateSlots';
import { gallerySettingsOf, } from '../../../blocks/types/GalleryBlock';
import { entityQueryToGalleryQuery, galleryQueryToEntityQuery, } from '../../../gallery/galleryLayout';
import { tileSrc, } from '../../../gallery/GalleryTile';
import DataBindingField from '../../entities/DataBindingField';
import AlignButtons, { type HAlign, } from '../../common/AlignButtons';
import Toggle from '../../common/Toggle';
import { FormField, } from '../../forms';
import './GalleryBlockEdit.scss';

const LAYOUTS: { value: GalleryBlockLayout; label: string; }[] = [
    { value: 'grid', label: 'Grid', },
    { value: 'row', label: 'Row (horizontal carousel)', },
    { value: 'column', label: 'Column (vertical list)', },
    { value: 'carousel', label: 'Carousel (one at a time)', },
    { value: 'stage', label: 'Stage (large + thumbnails)', },
    { value: 'masonry', label: 'Masonry (columns, natural heights)', },
];

const GalleryBlockEdit: Component<{
    data: Record<string, any>;
    onUpdate: (d: Record<string, any>,) => void;
}> = (props,) => {
    /** Read `slot`/`template` from the RAW settings: a normaliser that only
     *  knows items/query must not silently turn such a block into a query. */
    const source = (): GalleryBlockSettings['source'] => {
        const raw = (props.data as { source?: string; }).source;
        return raw === 'slot' || raw === 'template' ? raw : gallerySettingsOf(props.data,).source;
    };
    const s = (): GalleryBlockSettings => ({ ...gallerySettingsOf(props.data,), source: source(), });
    const set = (patch: Partial<GalleryBlockSettings>,) => props.onUpdate({ ...props.data, ...s(), ...patch, },);
    /** "Slot" is offered only inside a template that declares slots (or when
     *  the block already reads one, so it can be seen and switched away). */
    const offerSlot = () => templateSlots().length > 0 || source() === 'slot';
    /** "Template data": only when the open template binds gallery_item (or the
     *  block already reads it — kept visible, disabled, with a warning). */
    const tplData = () => templateDataSourceState(templateInfo(), 'gallery_item', 'gallery', source() === 'template',);
    const offerSource = () => offerSlot() || tplData().offer;
    const sourceValue = () => (source() === 'slot' || source() === 'template' ? source() : 'data');
    const [bp, setBp,] = createSignal<'desktop' | 'mobile'>('desktop',);

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

    /** The gallery source as "Set data…" sees it. */
    const dataBinding = (): SlotBinding | null => {
        if (s().source === 'items') return (s().itemIds ?? []).length ? { mode: 'list', refs: s().itemIds ?? [], } : null;
        if (s().source === 'query') return { mode: 'query', query: galleryQueryToEntityQuery(s().query,) as EntityQuery, };
        return null;
    };
    const applyBinding = (b: SlotBinding | null,) => {
        if (!b) set({ source: 'items', itemIds: [], },);
        else if (b.mode === 'query') set({ source: 'query', query: entityQueryToGalleryQuery(b.query, b.query.limit ?? s().query?.limit,), },);
        else {
            set({ source: 'items', itemIds: b.mode === 'list' ? [...b.refs,] : [b.ref,], },);
            void refetch();
        }
    };

    // The live query's collection by name (loaded only when one is chosen).
    const [collectionName,] = createResource(
        () => {
            const id = s().source === 'query' ? s().query?.collectionId : undefined;
            return id && id !== 'root' ? id : null;
        },
        async (id,) => (await cms.gallery.collections().catch(() => [],)).find((c,) => c.id === id,)?.name ?? null,
    );

    const querySummary = () => {
        const q = s().query ?? {};
        const parts = [
            q.type && q.type !== 'all' ? `${q.type}s` : 'all media',
            q.tag ? `tag ${q.tag}` : '',
            q.featured === true ? 'featured only' : q.featured === false ? 'not featured' : '',
            q.collectionId ? (q.collectionId === 'root' ? 'no collection' : collectionName.latest ? `in ${collectionName.latest}` : 'in a collection') : '',
            q.search ? `“${q.search}”` : '',
            `sorted by ${q.sort ?? 'gallery order'}${q.dir === 'desc' && (q.sort === 'title' || q.sort === 'order' || !q.sort) ? ' (reversed)' : ''}`,
            `up to ${q.limit ?? 12}`,
        ].filter(Boolean,);
        return `Live: ${parts.join(' · ',)}`;
    };

    return (
        <div class="gallery-block-edit">
            <Show when={!isFeatureEnabled('gallery',)}>
                <div class="alert alert--warning">The Gallery feature is off — this block shows nothing until it is enabled in Settings → Features.</div>
            </Show>

            <Show when={offerSource()}>
                <FormField
                    label="Source"
                    tooltip="This block's own data, the gallery item(s) this template is rendering, or the gallery items the block using this template puts in a slot."
                    hint={tplData().eachHint ?? undefined}
                >
                    <select
                        value={sourceValue()}
                        onChange={(e,) => {
                            const v = e.currentTarget.value;
                            set(v === 'slot' ? { source: 'slot', } : v === 'template' ? { source: 'template', } : { source: 'query', },);
                        }}
                    >
                        <option value="data">Data (selected items or a live query)</option>
                        <Show when={tplData().offer}>
                            <option value="template" disabled={!tplData().compatible}>
                                Template data (the gallery item{templateInfo()?.mode === 'list' ? 's' : ''} this template renders)
                            </option>
                        </Show>
                        <Show when={offerSlot()}>
                            <option value="slot">Slot (from the block using this template)</option>
                        </Show>
                    </select>
                </FormField>
                <Show when={tplData().warning}>
                    <div class="alert alert--warning">{tplData().warning}</div>
                </Show>
            </Show>

            <Show when={s().source === 'slot'}>
                <FormField
                    label="Slot"
                    hint="The block that uses this template chooses the gallery items for this slot."
                >
                    <select value={s().slotId ?? ''} onChange={(e,) => set({ slotId: e.currentTarget.value || undefined, },)}>
                        <option value="">— select a slot —</option>
                        <For each={slotChoices(templateSlots(), 'gallery_item',)}>
                            {(c,) => (
                                <option value={c.slot.id} disabled={!c.compatible}>
                                    {slotOptionLabel(c.slot,)}{c.compatible ? '' : ' (incompatible)'}
                                </option>
                            )}
                        </For>
                    </select>
                </FormField>
            </Show>

            <Show when={s().source !== 'slot' && s().source !== 'template'}>
                <DataBindingField
                    label="Data"
                    tooltip="Tick gallery items for a fixed selection (in the order picked), or tick none to save the filters as a live query that updates as the gallery changes."
                    entityType="gallery_item"
                    value={dataBinding()}
                    maxRecords={200}
                    summary={s().source === 'query' ? querySummary() : undefined}
                    emptyText="No items selected"
                    onChange={(b,) => applyBinding(b,)}
                >
                    <Show
                        when={s().source === 'items'}
                        fallback={
                            <FormField label="Limit" inline>
                                <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={s().query?.limit ?? 12}
                                    onChange={(e,) => set({ query: { ...(s().query ?? {}), limit: num(e.currentTarget.value,) ?? 12, }, },)}
                                />
                            </FormField>
                        }
                    >
                        <Show when={(s().itemIds ?? []).length > 0}>
                            <div class="gallery-block-edit__picked">
                                <For each={s().itemIds ?? []}>
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
                        </Show>
                    </Show>
                    <A href="/admin/gallery" class="form-help-muted">Manage the gallery</A>
                </DataBindingField>
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
                <Show when={layout() === 'masonry'}>
                    <FormField
                        label="Columns"
                        tooltip="Number of columns; each item goes to the shortest one. Empty = as many as fit at the Item width (else ~220px). Email uses at most 4."
                    >
                        <input type="number" min={1} max={12} value={opts().columns ?? ''} placeholder={ph('columns', 'auto',)} onChange={(e,) => setOpt({ columns: num(e.currentTarget.value,), },)} />
                    </FormField>
                    <FormField
                        label="Item width"
                        tooltip="Column width (e.g. 240px). With Columns set it is each column's maximum width — a narrower gallery is placed by the block's Horizontal Alignment; without Columns it decides how many columns fit."
                    >
                        <input type="text" value={opts().itemWidth ?? ''} placeholder={ph('itemWidth', 'auto',)} onChange={(e,) => setOpt({ itemWidth: e.currentTarget.value.trim() || undefined, },)} />
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
                {/* Masonry shows every item at its own aspect: no box height, aspect or fit. */}
                <Show when={layout() !== 'masonry'}>
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
                    <FormField
                        label="Fit"
                        tooltip="How each picture sits in its item box. Fill crops it to the box. Fit shows the whole picture centred in a box the same size as every other item. Hug shrinks each box to its picture's own shape."
                    >
                        <select value={opts().fit ?? ''} onChange={(e,) => setOpt({ fit: (e.currentTarget.value || undefined) as GalleryFit | undefined, },)}>
                            <Show when={bp() === 'mobile'}><option value="">= desktop</option></Show>
                            <option value="cover">Fill (crop)</option>
                            <option value="contain">Fit (whole picture, same-size boxes)</option>
                            <option value="hug">Hug (box takes the picture's shape)</option>
                        </select>
                    </FormField>
                </Show>
                <FormField
                    label="Item border radius"
                    tooltip="Corners of every item — tiles, the stage picture / video and the email thumbnails. Any CSS length (a bare number = px). Empty = the site's Border Radius (Settings → Appearance); 0 = square. Same on desktop and mobile."
                >
                    <input
                        type="text"
                        value={s().itemRadius ?? s().radius ?? ''}
                        placeholder="site default"
                        // Commits on change (blur / Enter). The legacy `radius` key is folded in.
                        onChange={(e,) => set({ itemRadius: e.currentTarget.value.trim() || undefined, radius: undefined, },)}
                    />
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
            <Show when={s().showTitles || s().showCaptions}>
                <div class="gallery-block-edit__grid">
                    <FormField label="Title position" tooltip="Where each item's title and caption go: under or above the picture, or on the picture (top or bottom). Stage: above or below the large picture (the 'on the picture' choices show below it).">
                        <select
                            value={s().titlePosition ?? 'below'}
                            onChange={(e,) => {
                                const v = e.currentTarget.value as GalleryTitlePosition;
                                set({ titlePosition: v === 'below' ? undefined : v, },);
                            }}
                        >
                            <option value="below">Below the picture</option>
                            <option value="above">Above the picture</option>
                            <option value="overlay-top">On the picture — top</option>
                            <option value="overlay-bottom">On the picture — bottom</option>
                        </select>
                    </FormField>
                    <FormField label="Title alignment" tooltip="Left, center or right. None selected = the block's Text Align. Click the selected button again to clear it.">
                        <AlignButtons
                            label="Title alignment"
                            value={s().titleAlign as HAlign}
                            onChange={(v,) => set({ titleAlign: s().titleAlign === v ? undefined : v, },)}
                        />
                    </FormField>
                </div>
            </Show>
            <div class="gallery-block-edit__grid">
                <FormField label="On click">
                    <select value={s().open ?? 'lightbox'} onChange={(e,) => set({ open: e.currentTarget.value as GalleryBlockSettings['open'], },)}>
                        <option value="lightbox">Open in a lightbox</option>
                        <option value="page">Go to the item's page</option>
                        <option value="none">Nothing</option>
                    </select>
                </FormField>
                <Show when={(s().open ?? 'lightbox') === 'lightbox'}>
                    <Toggle
                        checked={Boolean(s().thumbStrip,)}
                        onChange={(v,) => set({ thumbStrip: v, },)}
                        label="Thumbnail carousel in the lightbox"
                    />
                </Show>
            </div>

        </div>
    );
};

export default GalleryBlockEdit;
