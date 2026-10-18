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
import {
    bindingIdsIfStatic, DEFAULT_GALLERY_BLOCK_SETTINGS, slotFor, templateDataFor, templateDataIds, type TemplateDataLookup,
} from '@sitesurge/types';
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
    // `source: 'slot'` → the slot's gallery_item ids (same resolver as the entity block).
    // The source is a PRIMITIVE key of just the slot id + its definition and
    // binding, so a layout edit (columns, gap, fit) leaves it equal and Solid
    // does not re-resolve. A `single` / `list` binding already names its ids —
    // only a `query` needs the records fetched.
    const [slot,] = createResource(
        () => {
            const s = settings();
            if (s.source !== 'slot') return null;
            const ctx = slotCtx();
            const found = slotFor(ctx, s.slotId, 'gallery_item',);
            return JSON.stringify([s.slotId ?? null, found.ok ? found.slot : null, found.ok ? found.binding : null, found.ok ? null : found.reason,],);
        },
        async (key: string,): Promise<{ ok: true; ids: string[]; } | { ok: false; reason: 'missing' | 'unfilled' | 'incompatible'; }> => {
            const [slotId, , binding, reason,] = JSON.parse(key,) as [string | null, { array?: boolean; } | null, never, 'missing' | 'unfilled' | 'incompatible' | null,];
            if (reason) return { ok: false, reason, };
            const found = slotFor(slotCtx(), slotId ?? undefined, 'gallery_item',);
            const staticIds = found.ok ? bindingIdsIfStatic(binding, found.slot.array ? null : 1,) : null;
            if (staticIds) return { ok: true, ids: staticIds, };
            const r = await slotRecordsFor(slotCtx(), slotId ?? undefined, 'gallery_item',);
            return r.ok ? { ok: true, ids: slotRecordIds(r.records,), } : r;
        },
    );
    // `source: 'template'` → the gallery_item record(s) the template renders.
    const templateData = (): TemplateDataLookup | null =>
        settings().source === 'template' ? templateDataFor(slotCtx()?.templateData, 'gallery_item',) : null;
    // Keyed on the QUERY + viewer only (a JSON string), so layout-only edits
    // never refetch the items.
    const [items,] = createResource(
        () => {
            const s = settings();
            const viewer = user.user?.id ?? 'anon';
            if (s.source === 'template') {
                const t = templateData();
                return JSON.stringify([galleryBlockQuery(s, t?.ok ? templateDataIds(t.records,) : [],), viewer,],);
            }
            if (s.source === 'slot') {
                const r = slot();
                if (!r) return false; // still resolving
                return JSON.stringify([galleryBlockQuery(s, r.ok ? r.ids : [],), viewer,],);
            }
            return JSON.stringify([galleryBlockQuery(s,), viewer,],);
        },
        async (key: string,) => {
            const [q,] = JSON.parse(key,) as [GalleryQuery | null, string,];
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
