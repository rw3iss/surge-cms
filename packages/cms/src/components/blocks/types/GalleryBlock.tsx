/**
 * Gallery block (`gallery` feature): hand-picked items (`source: 'items'`,
 * shown in the picked order), a live query (`source: 'query'`), or — inside a
 * template — the enclosing template's slot (`source: 'slot'`, records of type
 * `gallery_item` → their ids, in order), or the record(s) the enclosing
 * `gallery_item` template is rendering (`source: 'template'`, the shared
 * `templateDataFor` rule), rendered
 * through the shared GalleryView with the block's layout settings (desktop +
 * mobile ≤768px). Items are fetched for THIS viewer, so gated items drop out.
 */
import type { Block, GalleryBlockSettings, GalleryItem, GalleryQuery, } from '@sitesurge/types';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, templateDataFor, templateDataIds, type TemplateDataLookup, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import GalleryView from '../../gallery/GalleryView';
import { SlotPlaceholder, slotRecordIds, slotRecordsFor, TemplateDataPlaceholder, useSlotContext, } from '../slotContext';
import { cms, } from '../../../services/cmsClient';
import { useUser, } from '../../../stores/auth';

/** Block settings with defaults filled in (the block may have been saved before a key existed). */
export function gallerySettingsOf(raw: unknown,): GalleryBlockSettings {
    const s = (raw ?? {}) as Partial<GalleryBlockSettings>;
    const d = DEFAULT_GALLERY_BLOCK_SETTINGS;
    return {
        ...d,
        ...s,
        source: s.source === 'items' || s.source === 'slot' || s.source === 'template' ? s.source : 'query',
        desktop: { ...d.desktop, ...(s.desktop ?? {}), },
        mobile: { ...(s.mobile ?? d.mobile ?? {}), },
        query: { ...(s.query ?? d.query ?? {}), },
    };
}

/** The query a block runs. `slotIds` = the ids resolved from its slot
 *  (`source: 'slot'`) or its template data (`source: 'template'`). */
export function galleryBlockQuery(s: GalleryBlockSettings, slotIds?: string[] | null,): GalleryQuery | null {
    if (s.source === 'items' || s.source === 'slot' || s.source === 'template') {
        const ids = ((s.source === 'items' ? s.itemIds : slotIds) ?? []).filter(Boolean,);
        return ids.length ? { ids, limit: Math.min(200, ids.length,), } : null;
    }
    return { ...(s.query ?? {}), };
}

export const GalleryBlock: Component<{ block: Block; }> = (props,) => {
    const user = useUser();
    const settings = () => gallerySettingsOf(props.block.settings,);
    const slotCtx = useSlotContext();
    // `source: 'slot'` → the slot's gallery_item records (same resolver as the entity block).
    const [slot,] = createResource(
        () => {
            const s = settings();
            if (s.source !== 'slot') return null;
            const ctx = slotCtx();
            // Track the slot + binding so a changed binding re-resolves.
            return { slotId: s.slotId, ctx, key: JSON.stringify([ctx?.slots, ctx?.bindings,],), };
        },
        ({ slotId, ctx, },) => slotRecordsFor(ctx, slotId, 'gallery_item',),
    );
    // `source: 'template'` → the gallery_item record(s) the template renders.
    const templateData = (): TemplateDataLookup | null =>
        settings().source === 'template' ? templateDataFor(slotCtx()?.templateData, 'gallery_item',) : null;
    const [items,] = createResource(
        () => {
            const s = settings();
            if (s.source === 'template') {
                const t = templateData();
                return { q: galleryBlockQuery(s, t?.ok ? templateDataIds(t.records,) : [],), viewer: user.user?.id ?? 'anon', };
            }
            if (s.source === 'slot') {
                const r = slot();
                if (!r) return false; // still resolving
                return { q: galleryBlockQuery(s, r.ok ? slotRecordIds(r.records,) : [],), viewer: user.user?.id ?? 'anon', };
            }
            return { q: galleryBlockQuery(s,), viewer: user.user?.id ?? 'anon', };
        },
        async ({ q, },) => {
            if (!q) return [] as GalleryItem[];
            try {
                return (await cms.gallery.list(q,)).items;
            } catch {
                return [] as GalleryItem[];
            }
        },
    );
    return (
        <div class="gallery-block">
            <Show when={(() => { const r = slot(); return r && !r.ok ? r : null; })()}>
                {(r,) => <SlotPlaceholder slotId={settings().slotId} reason={r().reason} />}
            </Show>
            <Show when={(() => { const t = templateData(); return t && !t.ok ? t : null; })()}>
                {(t,) => <TemplateDataPlaceholder label="Gallery" lookup={t()} />}
            </Show>
            <Show when={items()}>
                {(list,) => <GalleryView items={list()} settings={settings()} videoBadge />}
            </Show>
        </div>
    );
};
