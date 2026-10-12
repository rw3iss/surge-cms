/**
 * Gallery block (`gallery` feature): hand-picked items (`source: 'items'`,
 * shown in the picked order) or a live query (`source: 'query'`), rendered
 * through the shared GalleryView with the block's layout settings (desktop +
 * mobile ≤768px). Items are fetched for THIS viewer, so gated items drop out.
 */
import type { Block, GalleryBlockSettings, GalleryItem, GalleryQuery, } from '@sitesurge/types';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import GalleryView from '../../gallery/GalleryView';
import { cms, } from '../../../services/cmsClient';
import { useUser, } from '../../../stores/auth';

/** Block settings with defaults filled in (the block may have been saved before a key existed). */
export function gallerySettingsOf(raw: unknown,): GalleryBlockSettings {
    const s = (raw ?? {}) as Partial<GalleryBlockSettings>;
    const d = DEFAULT_GALLERY_BLOCK_SETTINGS;
    return {
        ...d,
        ...s,
        source: s.source === 'items' ? 'items' : 'query',
        desktop: { ...d.desktop, ...(s.desktop ?? {}), },
        mobile: { ...(s.mobile ?? d.mobile ?? {}), },
        query: { ...(s.query ?? d.query ?? {}), },
    };
}

/** The query a block runs. */
export function galleryBlockQuery(s: GalleryBlockSettings,): GalleryQuery | null {
    if (s.source === 'items') {
        const ids = (s.itemIds ?? []).filter(Boolean,);
        return ids.length ? { ids, limit: Math.min(200, ids.length,), } : null;
    }
    return { ...(s.query ?? {}), };
}

export const GalleryBlock: Component<{ block: Block; }> = (props,) => {
    const user = useUser();
    const settings = () => gallerySettingsOf(props.block.settings,);
    const [items,] = createResource(
        () => ({ q: galleryBlockQuery(settings(),), viewer: user.user?.id ?? 'anon', }),
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
            <Show when={items()}>
                {(list,) => <GalleryView items={list()} settings={settings()} videoBadge />}
            </Show>
        </div>
    );
};
