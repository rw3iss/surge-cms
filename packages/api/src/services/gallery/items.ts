/**
 * Gallery items: reads (viewer-gated, or email/public-media), and the admin's
 * publish/sync + single-item edits.
 *
 * Gate: each item's floor = its own visibility (`public` -1, `members` 0,
 * `tier` = the tier's rank) or, for `inherit`, the gallery's floor; a viewer
 * sees the item when `level >= floor`. Items whose media is gone, not ready,
 * or a video while videos are off are never public.
 *
 * Email / public renderers (`audience: 'email'`) skip the in-site gate and
 * return items whose MEDIA is public — their CDN URL is safe to put in an
 * email even when the gallery page itself is members-only.
 */
import crypto from 'crypto';
import {
    galleryItemPath, galleryMediaType, type GalleryItem, type GalleryListResult, type GalleryQuery, type GallerySettings,
    type GallerySyncBody, type GallerySyncResponse, type GalleryItemPatch,
} from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { ANONYMOUS_GRANTS, viewerGrants, type ViewerGrants, } from '../access/grants';
import { viewerLevel, type LevelViewer, } from '../access/level';
import { logAudit, } from '../audit';
import { cache, CACHE_KEYS, } from '../cache';
import type { AuditContext, } from '../types';
import { cleanRule, itemGateSql, ruleFromRow, } from './access';
import { galleryFloor, getSettings, } from './settings';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 200;
/** Staff level in SQL (Infinity does not bind). */
const STAFF_LEVEL = 1_000_000;

interface Row {
    id: string; media_id: string | null; title: string | null; caption: string | null; tags: string[]; sort_order: number;
    visibility: GalleryItem['visibility']; min_tier_id: string | null; comments: GalleryItem['comments'];
    anonymous_comments: GalleryItem['anonymousComments']; created_at: Date; updated_at: Date;
    collection_id: string | null; hidden_in_gallery: boolean | null; access_enabled: boolean; access_roles: string[] | null; access_tier_ids: string[] | null;
    m_id: string | null; m_mime: string | null; m_url: string | null; m_thumb: string | null; m_width: number | null; m_height: number | null;
    m_duration: number | null; m_title: string | null; m_caption: string | null; m_alt: string | null; m_credits: string | null;
    m_access: 'public' | 'private' | null; m_status: string | null; m_name: string | null; comment_count: number | null;
}

const SELECT = `
    SELECT gi.*, m.id AS m_id, m.mime_type AS m_mime, m.url AS m_url, m.thumbnail_url AS m_thumb, m.width AS m_width,
           m.height AS m_height, m.duration_ms AS m_duration, m.title AS m_title, m.caption AS m_caption, m.alt AS m_alt,
           m.credits AS m_credits, m.access_level AS m_access, m.status AS m_status, m.original_name AS m_name,
           ct.comment_count
      FROM gallery_items gi
      LEFT JOIN media m ON m.id = gi.media_id
      LEFT JOIN subscription_plans sp ON sp.id = gi.min_tier_id
      LEFT JOIN gallery_collections gc ON gc.id = gi.collection_id
      LEFT JOIN comment_threads ct ON ct.target_type = 'gallery_item' AND ct.target_id = gi.id`;

/** FROM + joins every gated read needs (counts, collection counts). */
export const ITEM_FROM = `FROM gallery_items gi LEFT JOIN media m ON m.id = gi.media_id
      LEFT JOIN subscription_plans sp ON sp.id = gi.min_tier_id
      LEFT JOIN gallery_collections gc ON gc.id = gi.collection_id`;

/** The item's floor in SQL ($floor = the gallery floor). */
const FLOOR_SQL = (galleryFloorParam: string,) =>
    `(CASE gi.visibility WHEN 'inherit' THEN ${galleryFloorParam} WHEN 'public' THEN -1 WHEN 'members' THEN 0 ELSE COALESCE(sp.sort_order, 0) END)`;

/** "media title" — no file extension. */
const nameOf = (file: string | null,) => (file ?? '').replace(/\.[a-z0-9]{2,5}$/i, '',).replace(/[_-]+/g, ' ',).trim();

export function mapRow(r: Row, baseUrl: string,): GalleryItem {
    const media = r.m_id
        ? {
            id: r.m_id,
            type: galleryMediaType(r.m_mime,),
            mimeType: r.m_mime ?? '',
            url: r.m_url ?? '',
            thumbnailUrl: r.m_thumb,
            width: r.m_width,
            height: r.m_height,
            durationMs: r.m_duration,
            title: r.m_title,
            caption: r.m_caption,
            alt: r.m_alt,
            credits: r.m_credits,
            accessLevel: (r.m_access ?? 'public') as 'public' | 'private',
            status: r.m_status ?? 'ready',
        }
        : null;
    return {
        id: r.id,
        collectionId: r.collection_id ?? null,
        access: ruleFromRow(r,),
        mediaId: r.media_id,
        media,
        mediaType: media?.type ?? null,
        title: r.title?.trim() || r.m_title?.trim() || nameOf(r.m_name,),
        caption: r.caption?.trim() || r.m_caption?.trim() || '',
        titleOverride: r.title,
        captionOverride: r.caption,
        tags: r.tags ?? [],
        sortOrder: r.sort_order,
        visibility: r.visibility,
        minTierId: r.min_tier_id,
        comments: r.comments,
        anonymousComments: r.anonymous_comments,
        url: galleryItemPath(baseUrl, r.id,),
        hiddenInGallery: Boolean(r.hidden_in_gallery,),
        commentCount: Number(r.comment_count ?? 0,),
        // A row is only ever INSERTed by the admin Publish (sync) and created_at is never updated, so it IS the publish date.
        publishedAt: new Date(r.created_at,).toISOString(),
        createdAt: new Date(r.created_at,).toISOString(),
        updatedAt: new Date(r.updated_at,).toISOString(),
    };
}

// ─── Query building ────────────────────────────────────────────────────────

export interface ListOptions {
    /** `site` (default): gated by the viewer's level. `email`: public media only, no gate. `admin`: everything. */
    audience?: 'site' | 'email' | 'admin';
    viewer?: LevelViewer;
    /** The viewer's roles + tiers, when the caller already built them (else built here). */
    grants?: ViewerGrants;
}

/** Normalise a query (ids/tags may arrive as comma strings). */
export function normalizeQuery(q: Omit<GalleryQuery, 'ids'> & { ids?: string[] | string; } = {},): Required<Pick<GalleryQuery, 'sort' | 'limit' | 'page'>> & GalleryQuery {
    const ids = (Array.isArray(q.ids,) ? q.ids : String(q.ids ?? '',).split(',',)).map((x,) => x.trim()).filter((x,) => UUID.test(x,));
    const sort = (['order', 'newest', 'oldest', 'title', 'random',] as const).includes(q.sort as never,) ? q.sort! : 'order';
    const coll = String(q.collectionId ?? '',).trim();
    return {
        ...q,
        collectionId: coll === 'root' || UUID.test(coll,) ? coll : undefined,
        ids: ids.length ? ids.slice(0, MAX_LIMIT,) : undefined,
        type: q.type === 'image' || q.type === 'video' ? q.type : 'all',
        tag: q.tag?.trim() || undefined,
        search: q.search?.trim().slice(0, 100,) || undefined,
        sort,
        dir: q.dir === 'desc' ? 'desc' : 'asc',
        limit: Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(q.limit,) || 24,),),),
        page: Math.max(1, Math.round(Number(q.page,) || 1,),),
        listing: q.listing === true || (q.listing as unknown) === 'true' || undefined,
    };
}

/**
 * The audience part of the item WHERE: public reads need ready media (and no
 * videos while they are off); `email` = public media only; `site` = the
 * viewer gate (item rule → collection rule → level floor). Shared with the
 * collection counts so a count and its listing always agree.
 */
export async function audienceConditions(opts: ListOptions, s: GallerySettings, params: unknown[],): Promise<string[]> {
    const where: string[] = [];
    const audience = opts.audience ?? 'site';
    if (audience !== 'admin') {
        where.push(`m.id IS NOT NULL AND m.status = 'ready'`,);
        if (!s.allowVideos) where.push(`m.mime_type NOT LIKE 'video/%'`,);
    }
    if (audience === 'email') where.push(`m.access_level = 'public'`,);
    if (audience === 'site') {
        const [level, grants,] = await Promise.all([
            viewerLevel(opts.viewer,),
            opts.grants ?? (opts.viewer?.id ? viewerGrants(opts.viewer,) : ANONYMOUS_GRANTS),
        ],);
        // Staff pass every gate: bind NOTHING for them — a bound parameter the
        // SQL never references makes Postgres fail ("could not determine data
        // type of parameter $1"), which emptied /gallery for signed-in staff.
        if (grants.staff) {
            where.push('TRUE',);
        } else {
            params.push(await galleryFloor(s,),);
            const floorParam = `$${params.length}`;
            params.push(level === Infinity ? STAFF_LEVEL : level,);
            where.push(itemGateSql(grants, `${FLOOR_SQL(floorParam,)} <= $${params.length}`, params,),);
        }
    }
    return where;
}

/**
 * Gallery-page listings (`listing`) leave out items hidden from the gallery and
 * items in a hidden collection — except on that collection's own page (the
 * query names it), which still lists its non-hidden items. Without `listing`
 * (blocks, templates, email, entity reads) nothing is left out.
 */
export function listingConditions(q: Pick<GalleryQuery, 'listing' | 'collectionId'>,): string[] {
    if (!q.listing) return [];
    const where = ['gi.hidden_in_gallery = false',];
    const namesCollection = Boolean(q.collectionId && q.collectionId !== 'root',);
    if (!namesCollection) where.push('COALESCE(gc.hidden_in_gallery, false) = false',);
    return where;
}

async function buildWhere(q: ReturnType<typeof normalizeQuery>, opts: ListOptions, s: GallerySettings, params: unknown[],): Promise<string> {
    const where = await audienceConditions(opts, s, params,);
    where.push(...listingConditions(q,),);
    if (q.collectionId === 'root') where.push('gi.collection_id IS NULL',);
    else if (q.collectionId) {
        params.push(q.collectionId,);
        where.push(`gi.collection_id = $${params.length}`,);
    }
    if (q.ids) {
        params.push(q.ids,);
        where.push(`gi.id = ANY($${params.length}::uuid[])`,);
    }
    if (q.type === 'image') where.push(`COALESCE(m.mime_type, '') NOT LIKE 'video/%'`,);
    if (q.type === 'video') where.push(`m.mime_type LIKE 'video/%'`,);
    if (q.tag) {
        params.push(q.tag.split(',',).map((t,) => t.trim().toLowerCase()).filter(Boolean,),);
        where.push(`gi.tags && $${params.length}::text[]`,);
    }
    if (q.search) {
        params.push(`%${q.search.replace(/[%_\\]/g, '\\$&',)}%`,);
        const p = `$${params.length}`;
        where.push(`(gi.title ILIKE ${p} OR gi.caption ILIKE ${p} OR m.title ILIKE ${p} OR m.caption ILIKE ${p} OR m.original_name ILIKE ${p})`,);
    }
    return where.length ? `WHERE ${where.join(' AND ',)}` : '';
}

function orderBy(q: ReturnType<typeof normalizeQuery>, params: unknown[],): string {
    if (q.ids) {
        params.push(q.ids,);
        return `ORDER BY array_position($${params.length}::uuid[], gi.id)`;
    }
    switch (q.sort) {
        case 'newest': return 'ORDER BY gi.created_at DESC';
        case 'oldest': return 'ORDER BY gi.created_at ASC';
        case 'title': return `ORDER BY lower(COALESCE(NULLIF(gi.title, ''), m.title, m.original_name)) ${q.dir === 'desc' ? 'DESC' : 'ASC'}`;
        case 'random': return 'ORDER BY random()';
        default: return q.dir === 'desc' ? 'ORDER BY gi.sort_order DESC, gi.created_at ASC' : 'ORDER BY gi.sort_order ASC, gi.created_at DESC';
    }
}

/** List / query. Anonymous site reads are cached (60 s) except random order. */
export async function list(raw: Omit<GalleryQuery, 'ids'> & { ids?: string[] | string; } = {}, opts: ListOptions = {},): Promise<GalleryListResult> {
    const q = normalizeQuery(raw,);
    const s = await getSettings();
    const anonymous = (opts.audience ?? 'site') === 'site' && !opts.viewer?.id;
    const cacheKey = anonymous && q.sort !== 'random'
        ? CACHE_KEYS.galleryList(crypto.createHash('sha1',).update(JSON.stringify(q,),).digest('hex',).slice(0, 16,),)
        : null;
    if (cacheKey) {
        const hit = await cache.get<GalleryListResult>(cacheKey,);
        if (hit) return hit;
    }
    const params: unknown[] = [];
    const where = await buildWhere(q, opts, s, params,);
    const countParams = [...params,];
    const order = orderBy(q, params,);
    params.push(q.limit, (q.page - 1) * q.limit,);
    const [rows, count,] = await Promise.all([
        query<Row>(`${SELECT} ${where} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params,),
        query<{ n: number; }>(
            `SELECT COUNT(*)::int AS n ${ITEM_FROM} ${where}`,
            countParams,
        ),
    ],);
    const out: GalleryListResult = { items: rows.rows.map((r,) => mapRow(r, s.baseUrl,),), total: count.rows[0]?.n ?? 0, page: q.page, limit: q.limit, };
    if (cacheKey) await cache.set(cacheKey, out, 60,);
    return out;
}

/** One item for a viewer; null when missing, media gone, or gated. */
export async function get(id: string, opts: ListOptions = {},): Promise<GalleryItem | null> {
    if (!UUID.test(id,)) return null;
    const r = await list({ ids: [id,], limit: 1, }, opts,);
    return r.items[0] ?? null;
}

/** Like `get`, but distinguishes "exists, gated" (for a sign-in prompt) from "missing". */
export async function getForViewer(id: string, viewer: LevelViewer,): Promise<{ item: GalleryItem | null; gated: boolean; }> {
    const item = await get(id, { viewer, },);
    if (item) return { item, gated: false, };
    const any = await get(id, { audience: 'admin', },);
    const s = await getSettings();
    const visible = any?.media && any.media.status === 'ready' && (s.allowVideos || any.media.type !== 'video');
    return { item: null, gated: Boolean(visible,), };
}

/** Every item for the admin (incl. orphaned), in gallery order. */
export async function adminList(): Promise<GalleryItem[]> {
    const s = await getSettings();
    const r = await query<Row>(`${SELECT} ORDER BY gi.sort_order ASC, gi.created_at DESC`,);
    return r.rows.map((x,) => mapRow(x, s.baseUrl,),);
}

// ─── Writes ────────────────────────────────────────────────────────────────

function cleanPatch(p: GalleryItemPatch,): GalleryItemPatch {
    const out: GalleryItemPatch = {};
    if (p.titleOverride !== undefined) out.titleOverride = p.titleOverride?.trim().slice(0, 300,) || null;
    if (p.captionOverride !== undefined) out.captionOverride = p.captionOverride?.trim().slice(0, 4000,) || null;
    if (p.tags !== undefined) {
        out.tags = [...new Set((p.tags ?? []).map((t,) => String(t,).trim().toLowerCase().slice(0, 40,)).filter(Boolean,),),].slice(0, 30,);
    }
    if (p.visibility !== undefined) {
        if (!['inherit', 'public', 'members', 'tier',].includes(p.visibility,)) throw new ValidationError('Unknown visibility.',);
        out.visibility = p.visibility;
    }
    if (p.minTierId !== undefined) out.minTierId = uuidOrNull(p.minTierId ?? undefined,);
    for (const k of ['comments', 'anonymousComments',] as const) {
        if (p[k] !== undefined) {
            if (!['inherit', 'on', 'off',].includes(p[k]!,)) throw new ValidationError(`Unknown ${k} value.`,);
            out[k] = p[k];
        }
    }
    if (p.collectionId !== undefined) {
        if (p.collectionId !== null && !UUID.test(p.collectionId,)) throw new ValidationError('Unknown collection.',);
        out.collectionId = p.collectionId;
    }
    if (p.access !== undefined) out.access = cleanRule(p.access,);
    if (p.hiddenInGallery !== undefined) out.hiddenInGallery = Boolean(p.hiddenInGallery,);
    if (out.visibility === 'tier' && out.minTierId === null) throw new ValidationError('Choose a tier for a tier-only item.',);
    return out;
}

const COLS: Record<Exclude<keyof GalleryItemPatch, 'access'>, string> = {
    titleOverride: 'title', captionOverride: 'caption', tags: 'tags', visibility: 'visibility', minTierId: 'min_tier_id',
    comments: 'comments', anonymousComments: 'anonymous_comments', collectionId: 'collection_id',
    hiddenInGallery: 'hidden_in_gallery',
};

/** SET fragments for the fields PRESENT in the patch — an omitted field stays as it is. */
export function setClause(p: GalleryItemPatch, params: unknown[],): string[] {
    const sets: string[] = [];
    for (const [k, col,] of Object.entries(COLS,) as [Exclude<keyof GalleryItemPatch, 'access'>, string][]) {
        if (p[k] === undefined) continue;
        params.push(p[k],);
        sets.push(`${col} = $${params.length}${col === 'tags' ? '::text[]' : ''}`,);
    }
    if (p.access) {
        params.push(p.access.enabled, p.access.roles, p.access.tierIds,);
        const n = params.length;
        sets.push(`access_enabled = $${n - 2}`, `access_roles = $${n - 1}::text[]`, `access_tier_ids = $${n}::uuid[]`,);
    }
    return sets;
}

/** Refuse collection ids that do not exist (the FK would otherwise 500). */
export async function assertCollectionsExist(ids: (string | null | undefined)[], run: typeof query = query,): Promise<void> {
    const wanted = [...new Set(ids.filter((x,): x is string => Boolean(x,),),),];
    if (!wanted.length) return;
    const r = await run<{ id: string; }>(`SELECT id FROM gallery_collections WHERE id = ANY($1::uuid[])`, [wanted,],);
    if (r.rows.length !== wanted.length) throw new ValidationError('That collection no longer exists.',);
}

export async function update(id: string, patch: GalleryItemPatch, ctx: AuditContext,): Promise<GalleryItem> {
    const p = cleanPatch(patch,);
    await assertCollectionsExist([p.collectionId,],);
    const params: unknown[] = [id,];
    const sets = setClause(p, params,);
    if (sets.length) {
        const r = await query(`UPDATE gallery_items SET ${sets.join(', ',)}, updated_at = NOW() WHERE id = $1`, params,);
        if (!r.rowCount) throw new NotFoundError('Gallery item',);
    }
    await cache.invalidateGalleryCache();
    await cache.invalidateSitemapCache();
    await logAudit({ userId: ctx.userId, action: 'gallery_item_update', entityType: 'gallery_item', entityId: id, newValues: p as never, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    const item = await get(id, { audience: 'admin', },);
    if (!item) throw new NotFoundError('Gallery item',);
    return item;
}

/** Remove one item; optionally delete its media from the library too. */
export async function remove(
    id: string, deleteMedia: boolean, ctx: AuditContext, forceMedia = false,
): Promise<{ removed: true; mediaDeleted: boolean; mediaKept: boolean; }> {
    const r = await query<{ media_id: string | null; }>(`DELETE FROM gallery_items WHERE id = $1 RETURNING media_id`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Gallery item',);
    await query(`DELETE FROM comment_threads WHERE target_type = 'gallery_item' AND target_id = $1`, [id,],).catch(() => {},);
    let outcome: MediaDeleteOutcome | null = null;
    if (deleteMedia && r.rows[0].media_id) outcome = await deleteMediaQuietly(r.rows[0].media_id, ctx, forceMedia,);
    await cache.invalidateGalleryCache();
    await cache.invalidateSitemapCache();
    await logAudit({ userId: ctx.userId, action: 'gallery_item_remove', entityType: 'gallery_item', entityId: id, newValues: { deleteMedia, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return { removed: true, mediaDeleted: outcome === 'deleted', mediaKept: outcome === 'kept', };
}

export type MediaDeleteOutcome = 'deleted' | 'kept' | 'failed';

/**
 * Delete a removed item's media. Runs AFTER the gallery row is gone, so the
 * usage check sees only OTHER uses: media still used elsewhere (a post's
 * featured image, a page block, …) is KEPT unless `force` — the caller
 * confirmed deleting it anyway.
 */
export async function deleteMediaQuietly(mediaId: string, ctx: AuditContext, force = false,): Promise<MediaDeleteOutcome> {
    try {
        if (!force) {
            const { findMediaUsage, } = await import('../mediaUsage.js');
            const usage = (await findMediaUsage([mediaId,],))[mediaId] ?? [];
            if (usage.length) {
                logger.info('gallery: media kept — still in use', { mediaId, uses: usage.length, },);
                return 'kept';
            }
        }
        const media = await import('../media.js');
        await media.remove(mediaId, ctx,);
        return 'deleted';
    } catch (err) {
        logger.warn('gallery: media delete failed', { mediaId, error: (err as Error).message, },);
        return 'failed';
    }
}

/**
 * Publish the admin's draft: the ordered list of items to keep (existing by
 * `id`, new by `mediaId`) + removals, in one transaction. Media deletions
 * (removals with `deleteMedia`) run after the commit — they touch storage.
 */
export async function sync(body: GallerySyncBody, ctx: AuditContext,): Promise<GallerySyncResponse> {
    const s = await getSettings();
    const removals = (body.remove ?? []).filter((r,) => UUID.test(r.id,),);
    const removeIds = new Set(removals.map((r,) => r.id,),);
    const keep = (body.items ?? []).filter((i,) => !(i.id && removeIds.has(i.id,)),);

    // New items: the media must exist, be unique in the request, and (videos off) not be a video.
    const newMediaIds = keep.filter((i,) => !i.id,).map((i,) => i.mediaId ?? '',);
    if (newMediaIds.some((m,) => !UUID.test(m,),)) throw new ValidationError('Every new gallery item needs a media id.',);
    if (new Set(newMediaIds,).size !== newMediaIds.length) throw new ValidationError('The same media is listed twice.',);
    await assertCollectionsExist(keep.map((i,) => i.collectionId,),);
    if (newMediaIds.length) {
        const m = await query<{ id: string; mime_type: string; }>(`SELECT id, mime_type FROM media WHERE id = ANY($1::uuid[])`, [newMediaIds,],);
        if (m.rows.length !== newMediaIds.length) throw new ValidationError('Some media no longer exists in the library.',);
        if (!s.allowVideos && m.rows.some((x,) => x.mime_type.startsWith('video/',),)) {
            throw new ValidationError('Videos are turned off in the gallery settings.',);
        }
    }

    let added = 0;
    let updated = 0;
    let removedCount = 0;
    const mediaToDelete: string[] = [];
    await transaction(async (client,) => {
        for (const r of removals) {
            const d = await client.query<{ media_id: string | null; }>(`DELETE FROM gallery_items WHERE id = $1 RETURNING media_id`, [r.id,],);
            if (d.rows[0]) {
                removedCount += 1;
                await client.query(`DELETE FROM comment_threads WHERE target_type = 'gallery_item' AND target_id = $1`, [r.id,],);
                if (r.deleteMedia && d.rows[0].media_id) mediaToDelete.push(d.rows[0].media_id,);
            }
        }
        let order = 0;
        for (const item of keep) {
            const p = cleanPatch(item,);
            if (item.id) {
                const params: unknown[] = [item.id, order,];
                const sets = setClause(p, params,);
                const u = await client.query(
                    `UPDATE gallery_items SET sort_order = $2${sets.length ? `, ${sets.join(', ',)}` : ''}, updated_at = NOW() WHERE id = $1`,
                    params,
                );
                if (u.rowCount) updated += 1;
            } else {
                // Already in the gallery (published elsewhere meanwhile) → just move it.
                const existing = await client.query<{ id: string; }>(`SELECT id FROM gallery_items WHERE media_id = $1`, [item.mediaId,],);
                if (existing.rows[0]) {
                    await client.query(`UPDATE gallery_items SET sort_order = $2, updated_at = NOW() WHERE id = $1`, [existing.rows[0].id, order,],);
                    updated += 1;
                } else {
                    const access = p.access ?? { enabled: false, roles: [], tierIds: [], };
                    await client.query(
                        `INSERT INTO gallery_items (media_id, sort_order, title, caption, tags, visibility, min_tier_id, comments, anonymous_comments, created_by,
                                                    collection_id, access_enabled, access_roles, access_tier_ids, hidden_in_gallery)
                         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11, $12, $13::text[], $14::uuid[], $15)`,
                        [
                            item.mediaId, order, p.titleOverride ?? null, p.captionOverride ?? null, p.tags ?? [], p.visibility ?? 'inherit',
                            p.minTierId ?? null, p.comments ?? 'inherit', p.anonymousComments ?? 'inherit', uuidOrNull(ctx.userId,),
                            p.collectionId ?? null, access.enabled, access.roles, access.tierIds, p.hiddenInGallery ?? false,
                        ],
                    );
                    added += 1;
                }
            }
            order += 1;
        }
    },);

    let mediaDeleted = 0;
    let mediaKept = 0;
    for (const id of mediaToDelete) {
        const outcome = await deleteMediaQuietly(id, ctx, Boolean(body.forceMedia,),);
        if (outcome === 'deleted') mediaDeleted += 1;
        else if (outcome === 'kept') mediaKept += 1;
    }
    await cache.invalidateGalleryCache();
    await cache.invalidateSitemapCache();
    await logAudit({
        userId: ctx.userId, action: 'gallery_publish', entityType: 'gallery', entityId: undefined,
        newValues: { added, updated, removed: removedCount, mediaDeleted, mediaKept, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return { items: await adminList(), added, updated, removed: removedCount, mediaDeleted, mediaKept, };
}

/** Item ids for media (the Media library shows which media is published). */
export async function itemsForMedia(mediaIds: string[],): Promise<Map<string, string>> {
    const ids = mediaIds.filter((m,) => UUID.test(m,),);
    if (!ids.length) return new Map();
    const r = await query<{ id: string; media_id: string; }>(`SELECT id, media_id FROM gallery_items WHERE media_id = ANY($1::uuid[])`, [ids,],);
    return new Map(r.rows.map((x,) => [x.media_id, x.id,],),);
}
