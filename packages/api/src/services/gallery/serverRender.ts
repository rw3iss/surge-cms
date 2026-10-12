/**
 * Server side of `{{gallery(...)}}` and the Gallery block — resolution for the
 * two backend renderers (SSR + email).
 *
 *   `resolveGalleryFunction` — the template function, for
 *     `template/backendRuntime.ts`. SSR resolves as the ANONYMOUS site viewer
 *     (a crawler never sees gated items); email resolves with the `email`
 *     audience: PUBLIC MEDIA ONLY, ignoring the in-site gate — a newsletter
 *     may show a members-only gallery item when its media is public, by the
 *     media's own CDN URL.
 *   `resolveGalleryBlockItems` — the block's items (hand-picked ids or a
 *     query) for the same two audiences; the synchronous block emitters read
 *     them from `settings[GALLERY_RESOLVED_KEY]`, stashed by a pre-pass.
 *
 * Never throws: the feature off, a missing table or a bad query → no items.
 */
import {
    entityRef, GALLERY_ITEM_KIND, GALLERY_LIST_KIND, galleryCallFor, UNRESOLVED,
    type GalleryBlockSettings, type GalleryItem, type GalleryQuery,
} from '@sitesurge/types';
import { isFeatureEnabledServer, } from '../settings';
import type { AsyncMemo, } from '../template/backendRuntime';
import { get, list, type ListOptions, } from './items';

export type ServerGalleryAudience = 'site' | 'email';

/** Settings key the pre-pass stashes a Gallery block's resolved items under. */
export const GALLERY_RESOLVED_KEY = '__galleryItems';

const optsFor = (audience: ServerGalleryAudience,): ListOptions => (audience === 'email' ? { audience: 'email', } : { audience: 'site', viewer: null, });

async function enabled(): Promise<boolean> {
    return isFeatureEnabledServer('gallery',).catch(() => false);
}

/** Resolve `gallery(...)`, or UNRESOLVED when `name` is not it. */
export async function resolveGalleryFunction(
    name: string, args: unknown[], named: Record<string, unknown> | undefined, memo: AsyncMemo, audience: ServerGalleryAudience,
): Promise<unknown> {
    const call = galleryCallFor(name, args, named ?? {},);
    if (!call) return UNRESOLVED;
    if (!(await enabled())) return call.single ? entityRef(GALLERY_ITEM_KIND, null,) : entityRef(GALLERY_LIST_KIND, [] as never,);
    if (call.single) {
        const id = call.query.ids![0];
        const item = await memo(`gallery:${audience}:item:${id}`, () => get(id, optsFor(audience,),).catch(() => null),);
        return entityRef(GALLERY_ITEM_KIND, item as unknown as Record<string, unknown> | null, id,);
    }
    const items = await memo(`gallery:${audience}:${JSON.stringify(call.query,)}`, () => fetchItems(call.query, audience,),);
    return entityRef(GALLERY_LIST_KIND, items as unknown as Record<string, unknown>,);
}

async function fetchItems(q: GalleryQuery, audience: ServerGalleryAudience,): Promise<GalleryItem[]> {
    return list(q, optsFor(audience,),).then((r,) => r.items,).catch(() => [],);
}

/** A Gallery block's items for this audience (ids keep their hand-picked order). */
export async function resolveGalleryBlockItems(settings: Partial<GalleryBlockSettings> | null | undefined, audience: ServerGalleryAudience,): Promise<GalleryItem[]> {
    if (!settings || !(await enabled())) return [];
    if (settings.source === 'items') {
        const ids = (settings.itemIds ?? []).filter(Boolean,);
        if (!ids.length) return [];
        return fetchItems({ ids, limit: ids.length, }, audience,);
    }
    return fetchItems({ ...(settings.query ?? {}), }, audience,);
}

/**
 * Pre-pass for a flat block list: stash each Gallery block's items on its
 * settings so the synchronous emitter can render them. Returns a NEW list
 * (blocks are not mutated in place).
 */
export async function preResolveGalleryBlocks<B extends { type?: string; blockType?: string; settings?: Record<string, unknown> | null; }>(
    blocks: B[], audience: ServerGalleryAudience,
): Promise<B[]> {
    if (!blocks.some((b,) => (b.type ?? b.blockType) === 'gallery',)) return blocks;
    return Promise.all(blocks.map(async (b,) => {
        if ((b.type ?? b.blockType) !== 'gallery') return b;
        const items = await resolveGalleryBlockItems(b.settings as Partial<GalleryBlockSettings>, audience,).catch(() => [],);
        return { ...b, settings: { ...(b.settings ?? {}), [GALLERY_RESOLVED_KEY]: items, }, };
    },),);
}

/** The stashed items on a block's settings. */
export function resolvedItemsOf(settings: Record<string, unknown> | null | undefined,): GalleryItem[] {
    const v = settings?.[GALLERY_RESOLVED_KEY];
    return Array.isArray(v,) ? (v as GalleryItem[]) : [];
}
