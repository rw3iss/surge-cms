/**
 * Gallery collections: one-level folders of gallery items, each with an
 * optional role / subscription-level access rule (see `./access`).
 *
 * Public reads are viewer-shaped in SQL: a collection is listed / openable
 * only when its rule is inactive or the viewer passes it, and `itemCount` +
 * the cover come from the SAME item gate as the item listing, so a count
 * always matches what the collection page shows.
 */
import {
    galleryCollectionPath, type GalleryCollection, type GalleryCollectionDeleteBody, type GalleryCollectionDeleteResponse,
    type GalleryCollectionInput, type GalleryMoveItemsBody, type GalleryMoveItemsResponse,
} from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, transaction, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';
import { ANONYMOUS_GRANTS, viewerGrants, type ViewerGrants, } from '../access/grants';
import type { LevelViewer, } from '../access/level';
import { logAudit, } from '../audit';
import { cache, CACHE_KEYS, } from '../cache';
import type { AuditContext, } from '../types';
import { cleanRule, collectionGateSql, ruleFromRow, } from './access';
import { assertCollectionsExist, audienceConditions, deleteMediaQuietly, ITEM_FROM, } from './items';
import { getSettings, } from './settings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CollectionRow {
    id: string; name: string; description: string; sort_order: number;
    access_enabled: boolean; access_roles: string[] | null; access_tier_ids: string[] | null; hidden_in_gallery: boolean | null;
    created_at: Date; updated_at: Date; item_count: number | null; cover: string | null;
}

export function mapCollection(r: CollectionRow, baseUrl: string,): GalleryCollection {
    return {
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        sortOrder: r.sort_order,
        access: ruleFromRow(r,),
        itemCount: Number(r.item_count ?? 0,),
        coverThumbnailUrl: r.cover ?? null,
        url: galleryCollectionPath(baseUrl, r.id,),
        hiddenInGallery: Boolean(r.hidden_in_gallery,),
        createdAt: new Date(r.created_at,).toISOString(),
        updatedAt: new Date(r.updated_at,).toISOString(),
    };
}

type Audience = 'site' | 'admin';

/**
 * Collections with counts + covers for an audience. `site` lists only the
 * collections the viewer may open and counts only the items they may see.
 */
async function select(audience: Audience, viewer: LevelViewer, grants: ViewerGrants, id?: string, listing = false,): Promise<GalleryCollection[]> {
    const s = await getSettings();
    const params: unknown[] = [];
    // Item conditions inside the correlated subqueries; `gc` = the outer collection row.
    const itemWhere = await audienceConditions(audience === 'admin' ? { audience: 'admin', } : { viewer, grants, }, s, params,);
    // Site counts / covers follow the collection page's grid, which never lists an item hidden from the gallery.
    if (audience === 'site') itemWhere.push('gi.hidden_in_gallery = false',);
    const itemCond = ['gi.collection_id = gc.id', ...itemWhere,].join(' AND ',);
    const where: string[] = [];
    if (audience === 'site') where.push(collectionGateSql(grants, params,),);
    // Gallery-page listing: hidden collections are not listed (their item counts / covers need no change — a
    // collection page lists its own non-hidden items, and those are what itemCount counts).
    if (listing) where.push('gc.hidden_in_gallery = false',);
    if (id) {
        params.push(id,);
        where.push(`gc.id = $${params.length}`,);
    }
    // Drop ITEM_FROM's own `gc` join: in the subqueries `gc` is the OUTER collection row, which is the item's collection.
    const inner = ITEM_FROM.replace('LEFT JOIN gallery_collections gc ON gc.id = gi.collection_id', '',);
    const r = await query<CollectionRow>(
        `SELECT gc.*,
                (SELECT COUNT(*)::int ${inner} WHERE ${itemCond}) AS item_count,
                (SELECT COALESCE(m.thumbnail_url, CASE WHEN m.mime_type NOT LIKE 'video/%' THEN m.url END) ${inner}
                  WHERE ${itemCond} AND m.id IS NOT NULL ORDER BY gi.sort_order ASC, gi.created_at DESC LIMIT 1) AS cover
           FROM gallery_collections gc
          ${where.length ? `WHERE ${where.join(' AND ',)}` : ''}
          ORDER BY gc.sort_order ASC, lower(gc.name) ASC, gc.created_at ASC`,
        params,
    );
    return r.rows.map((x,) => mapCollection(x, s.baseUrl,),);
}

/**
 * Collections visible to a site viewer (anonymous result cached 60 s).
 * `listing` (the gallery pages) leaves out collections hidden from the gallery.
 */
export async function listCollections(viewer: LevelViewer, grants?: ViewerGrants, opts: { listing?: boolean; } = {},): Promise<GalleryCollection[]> {
    const anonymous = !viewer?.id;
    const listing = Boolean(opts.listing,);
    const key = listing ? CACHE_KEYS.galleryCollectionsListing : CACHE_KEYS.galleryCollections;
    if (anonymous) {
        const hit = await cache.get<GalleryCollection[]>(key,);
        if (hit) return hit;
    }
    const g = grants ?? (anonymous ? ANONYMOUS_GRANTS : await viewerGrants(viewer,));
    const out = await select('site', viewer, g, undefined, listing,);
    if (anonymous) await cache.set(key, out, 60,);
    return out;
}

/** One collection for a site viewer; null when missing or the viewer fails its rule. */
export async function getCollection(id: string, viewer: LevelViewer,): Promise<GalleryCollection | null> {
    if (!UUID.test(id,)) return null;
    const g = viewer?.id ? await viewerGrants(viewer,) : ANONYMOUS_GRANTS;
    return (await select('site', viewer, g, id,))[0] ?? null;
}

/** Like `getCollection`, but tells "exists, gated" (noindex / sign-in) from "missing" (404). */
export async function getCollectionForViewer(id: string, viewer: LevelViewer,): Promise<{ collection: GalleryCollection | null; gated: boolean; }> {
    const collection = await getCollection(id, viewer,);
    if (collection) return { collection, gated: false, };
    const exists = UUID.test(id,) ? (await query(`SELECT 1 FROM gallery_collections WHERE id = $1`, [id,],)).rows.length > 0 : false;
    return { collection: null, gated: exists, };
}

/** Every collection, counts of ALL items (admin). */
export async function adminCollections(): Promise<GalleryCollection[]> {
    return select('admin', null, ANONYMOUS_GRANTS,);
}

async function adminCollection(id: string,): Promise<GalleryCollection> {
    const c = (await select('admin', null, ANONYMOUS_GRANTS, id,))[0];
    if (!c) throw new NotFoundError('Gallery collection',);
    return c;
}

function cleanInput(input: GalleryCollectionInput,) {
    const out: { name?: string; description?: string; sortOrder?: number; access?: ReturnType<typeof cleanRule>; hiddenInGallery?: boolean; } = {};
    if (input.name !== undefined) out.name = String(input.name ?? '',).trim().slice(0, 200,) || 'Untitled';
    if (input.description !== undefined) out.description = String(input.description ?? '',).slice(0, 4000,);
    if (input.sortOrder !== undefined) {
        const n = Math.round(Number(input.sortOrder,),);
        if (!Number.isFinite(n,)) throw new ValidationError('Sort order must be a number.',);
        out.sortOrder = n;
    }
    if (input.access !== undefined) out.access = cleanRule(input.access,);
    if (input.hiddenInGallery !== undefined) out.hiddenInGallery = Boolean(input.hiddenInGallery,);
    return out;
}

async function changed(): Promise<void> {
    await cache.invalidateGalleryCache();
    await cache.invalidateSitemapCache();
}

/** Create a collection. Without a `sortOrder` it goes FIRST (before every other collection). */
export async function createCollection(input: GalleryCollectionInput, ctx: AuditContext,): Promise<GalleryCollection> {
    const c = cleanInput(input,);
    const access = c.access ?? { enabled: false, roles: [], tierIds: [], };
    const r = await query<{ id: string; }>(
        `INSERT INTO gallery_collections (name, description, sort_order, access_enabled, access_roles, access_tier_ids, created_by, hidden_in_gallery)
         VALUES ($1, $2, COALESCE($3::int, (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM gallery_collections)), $4, $5::text[], $6::uuid[], $7, $8)
         RETURNING id`,
        [c.name ?? 'Untitled', c.description ?? '', c.sortOrder ?? null, access.enabled, access.roles, access.tierIds, uuidOrNull(ctx.userId,), c.hiddenInGallery ?? false,],
    );
    const id = r.rows[0].id;
    await changed();
    await logAudit({ userId: ctx.userId, action: 'gallery_collection_create', entityType: 'gallery_collection', entityId: id, newValues: c as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return adminCollection(id,);
}

export async function updateCollection(id: string, input: GalleryCollectionInput, ctx: AuditContext,): Promise<GalleryCollection> {
    const c = cleanInput(input,);
    const sets: string[] = [];
    const params: unknown[] = [id,];
    const set = (col: string, v: unknown, cast = '',) => {
        params.push(v,);
        sets.push(`${col} = $${params.length}${cast}`,);
    };
    if (c.name !== undefined) set('name', c.name,);
    if (c.description !== undefined) set('description', c.description,);
    if (c.sortOrder !== undefined) set('sort_order', c.sortOrder,);
    if (c.hiddenInGallery !== undefined) set('hidden_in_gallery', c.hiddenInGallery,);
    if (c.access) {
        set('access_enabled', c.access.enabled,);
        set('access_roles', c.access.roles, '::text[]',);
        set('access_tier_ids', c.access.tierIds, '::uuid[]',);
    }
    const r = await query(`UPDATE gallery_collections SET ${[...sets, 'updated_at = NOW()',].join(', ',)} WHERE id = $1`, params,);
    if (!r.rowCount) throw new NotFoundError('Gallery collection',);
    await changed();
    await logAudit({ userId: ctx.userId, action: 'gallery_collection_update', entityType: 'gallery_collection', entityId: id, newValues: c as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return adminCollection(id,);
}

/**
 * Delete a collection, in ONE transaction with what happens to its items:
 * `delete` removes them (+ their comment threads; media only with
 * `deleteMedia`, after the commit — it touches storage), `root` moves them to
 * the gallery root, `move` moves them into `targetId`.
 */
export async function deleteCollection(id: string, body: GalleryCollectionDeleteBody, ctx: AuditContext,): Promise<GalleryCollectionDeleteResponse> {
    if (!['delete', 'root', 'move',].includes(body.items,)) throw new ValidationError('Choose what happens to the items.',);
    if (body.items === 'move') {
        if (!body.targetId || !UUID.test(body.targetId,)) throw new ValidationError('Choose the collection to move the items to.',);
        if (body.targetId === id) throw new ValidationError('Choose a different collection to move the items to.',);
    }
    const mediaToDelete: string[] = [];
    let count = 0;
    await transaction(async (client,) => {
        const exists = await client.query(`SELECT id FROM gallery_collections WHERE id = $1 FOR UPDATE`, [id,],);
        if (!exists.rows[0]) throw new NotFoundError('Gallery collection',);
        if (body.items === 'delete') {
            const d = await client.query<{ id: string; media_id: string | null; }>(
                `DELETE FROM gallery_items WHERE collection_id = $1 RETURNING id, media_id`, [id,],
            );
            count = d.rows.length;
            if (count) {
                await client.query(`DELETE FROM comment_threads WHERE target_type = 'gallery_item' AND target_id = ANY($1::uuid[])`, [d.rows.map((x,) => x.id,),],);
            }
            if (body.deleteMedia) for (const x of d.rows) if (x.media_id) mediaToDelete.push(x.media_id,);
        } else if (body.items === 'root') {
            const u = await client.query(`UPDATE gallery_items SET collection_id = NULL, updated_at = NOW() WHERE collection_id = $1`, [id,],);
            count = u.rowCount ?? 0;
        } else {
            await assertCollectionsExist([body.targetId,], client.query.bind(client,) as never,);
            const u = await client.query(`UPDATE gallery_items SET collection_id = $2, updated_at = NOW() WHERE collection_id = $1`, [id, body.targetId,],);
            count = u.rowCount ?? 0;
        }
        await client.query(`DELETE FROM gallery_collections WHERE id = $1`, [id,],);
    },);
    let mediaDeleted = 0;
    for (const m of mediaToDelete) if (await deleteMediaQuietly(m, ctx,)) mediaDeleted += 1;
    await changed();
    await logAudit({
        userId: ctx.userId, action: 'gallery_collection_delete', entityType: 'gallery_collection', entityId: id,
        newValues: { items: body.items, targetId: body.targetId, count, mediaDeleted, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return { deleted: true, items: count, mediaDeleted, };
}

/** Move items into a collection (null = the gallery root). */
export async function moveItems(body: GalleryMoveItemsBody, ctx: AuditContext,): Promise<GalleryMoveItemsResponse> {
    const ids = [...new Set((body.ids ?? []).filter((x,) => UUID.test(x,),),),];
    const target = body.collectionId ?? null;
    if (target !== null && !UUID.test(target,)) throw new ValidationError('Unknown collection.',);
    if (!ids.length) return { moved: 0, };
    await assertCollectionsExist([target,],);
    const r = await query(
        `UPDATE gallery_items SET collection_id = $2, updated_at = NOW() WHERE id = ANY($1::uuid[]) AND collection_id IS DISTINCT FROM $2::uuid`,
        [ids, target,],
    );
    const moved = r.rowCount ?? 0;
    await changed();
    await logAudit({ userId: ctx.userId, action: 'gallery_items_move', entityType: 'gallery', entityId: undefined, newValues: { ids, collectionId: target, moved, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return { moved, };
}
