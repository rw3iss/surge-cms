/**
 * Gallery block (`gallery` feature): hand-picked items (`source: 'items'`,
 * shown in the picked order), a live query (`source: 'query'`), or — inside a
 * template — the enclosing template's slot (`source: 'slot'`, records of type
 * `gallery_item` → their ids, in order), rendered
 * through the shared GalleryView with the block's layout settings (desktop +
 * mobile ≤768px). Items are fetched for THIS viewer, so gated items drop out.
 */
import type { Block, GalleryBlockSettings, GalleryItem, GalleryQuery, } from '@sitesurge/types';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import GalleryView from '../../gallery/GalleryView';
import { SlotPlaceholder, slotRecordIds, slotRecordsFor, useSlotContext, } from '../slotContext';
import { cms, } from '../../../services/cmsClient';
import { useUser, } from '../../../stores/auth';

/** Block settings with defaults filled in (the block may have been saved before a key existed). */
export function gallerySettingsOf(raw: unknown,): GalleryBlockSettings {
    const s = (raw ?? {}) as Partial<GalleryBlockSettings>;
    const d = DEFAULT_GALLERY_BLOCK_SETTINGS;
    return {
        ...d,
        ...s,
        source: s.source === 'items' || s.source === 'slot' ? s.source : 'query',
        desktop: { ...d.desktop, ...(s.desktop ?? {}), },
        mobile: { ...(s.mobile ?? d.mobile ?? {}), },
        query: { ...(s.query ?? d.query ?? {}), },
    };
}

/** The query a block runs. `slotIds` = the ids resolved from its slot (`source: 'slot'`). */
export function galleryBlockQuery(s: GalleryBlockSettings, slotIds?: string[] | null,): GalleryQuery | null {
    if (s.source === 'items' || s.source === 'slot') {
        const ids = ((s.source === 'slot' ? slotIds : s.itemIds) ?? []).filter(Boolean,);
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
    const [items,] = createResource(
        () => {
            const s = settings();
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
            <Show when={items()}>
                {(list,) => <GalleryView items={list()} settings={settings()} videoBadge />}
            </Show>
        </div>
    );
};
