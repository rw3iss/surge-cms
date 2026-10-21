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
import { AppError, NotFoundError, ValidationError, } from '../../core/errors';
import type { PoolClient, } from 'pg';
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
    collection_id: string | null; hidden_in_gallery: boolean | null; is_featured?: boolean | null; access_enabled: boolean; access_roles: string[] | null; access_tier_ids: string[] | null;
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
        isFeatured: Boolean(r.is_featured,),
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
        // Only a random order uses the seed; elsewhere it would just split the cache.
        seed: sort === 'random' && /^[\w-]{1,32}$/.test(String(q.seed ?? '',),) ? String(q.seed,) : undefined,
        limit: Math.min(MAX_LIMIT, Math.max(1, Math.round(Number(q.limit,) || 24,),),),
        page: Math.max(1, Math.round(Number(q.page,) || 1,),),
        listing: q.listing === true || (q.listing as unknown) === 'true' || undefined,
        featured: q.featured === true || (q.featured as unknown) === 'true' ? true
            : q.featured === false || (q.featured as unknown) === 'false' ? false : undefined,
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
    if (q.featured === true) where.push('gi.is_featured = true',);
    if (q.featured === false) where.push('gi.is_featured = false',);
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
        case 'random': {
            // Seeded: every page of one session shares the same shuffle (C7).
            if (!q.seed) return 'ORDER BY random()';
            params.push(q.seed,);
            return `ORDER BY md5(gi.id::text || $${params.length}), gi.id`;
        }
        default: return q.dir === 'desc' ? 'ORDER BY gi.sort_order DESC, gi.created_at ASC' : 'ORDER BY gi.sort_order ASC, gi.created_at DESC';
    }
}

/**
 * Everything the site gate reads about a viewer, as one string: two viewers
 * with the same signature see exactly the same items (`audienceConditions`
 * uses only the level and the grants).
 */
export function viewerSignature(level: number, g: ViewerGrants,): string {
    if (g.staff) return 'staff';
    return `l${level}|r${[...g.roles,].sort().join(',',)}|t${[...g.tierIds,].sort().join(',',)}|${g.signedIn ? 's' : 'a'}`;
}

/** List / query. Site reads are cached (60 s) per viewer signature, except an unseeded random order. */
export async function list(raw: Omit<GalleryQuery, 'ids'> & { ids?: string[] | string; } = {}, opts: ListOptions = {},): Promise<GalleryListResult> {
    const q = normalizeQuery(raw,);
    const s = await getSettings();
    // Site reads are cached per VIEWER SIGNATURE (F4) — every input of the
    // gate: level + staff + roles + tiers — so members sharing a signature
    // share an entry (anonymous is one signature). An unseeded random order is
    // different every time, so never cached; a seeded one carries its seed.
    let cacheKey: string | null = null;
    if ((opts.audience ?? 'site') === 'site' && (q.sort !== 'random' || q.seed)) {
        let sig = 'anon';
        if (opts.viewer?.id) {
            const grants = opts.grants ?? await viewerGrants(opts.viewer,);
            opts = { ...opts, grants, };
            sig = viewerSignature(await viewerLevel(opts.viewer,), grants,);
        }
        cacheKey = CACHE_KEYS.galleryList(crypto.createHash('sha1',).update(JSON.stringify({ q, sig, },),).digest('hex',).slice(0, 16,),);
    }
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
    if (p.isFeatured !== undefined) out.isFeatured = Boolean(p.isFeatured,);
    if (out.visibility === 'tier' && out.minTierId === null) throw new ValidationError('Choose a tier for a tier-only item.',);
    return out;
}

const COLS: Record<Exclude<keyof GalleryItemPatch, 'access'>, string> = {
    titleOverride: 'title', captionOverride: 'caption', tags: 'tags', visibility: 'visibility', minTierId: 'min_tier_id',
    comments: 'comments', anonymousComments: 'anonymous_comments', collectionId: 'collection_id',
    hiddenInGallery: 'hidden_in_gallery', isFeatured: 'is_featured',
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

/** Which items `removeGalleryItems` removes (exactly one key). */
export type GalleryItemSelector = { ids: string[]; } | { collectionId: string; } | { mediaId: string; };

/**
 * THE way gallery items are removed (item remove, Publish removals, collection
 * delete, media discard), inside the caller's transaction:
 *   1. delete the rows,
 *   2. soft-delete their comments through the discussions engine (`setStatus`
 *      → 'deleted'), so author activity counts, reply counts and discovery
 *      feeds stop counting comments on an item that no longer exists,
 *   3. delete their comment threads.
 * Caches + audit stay with the caller (each audits its own act). Returns the
 * removed item ids and their media ids (for an optional media delete).
 */
export async function removeGalleryItems(
    client: PoolClient, sel: GalleryItemSelector,
): Promise<{ ids: string[]; mediaIds: string[]; rows: { id: string; mediaId: string | null; }[]; }> {
    let where: string;
    let param: unknown;
    if ('ids' in sel) {
        const ids = sel.ids.filter((x,) => UUID.test(x,),);
        if (!ids.length) return { ids: [], mediaIds: [], rows: [], };
        where = 'id = ANY($1::uuid[])';
        param = ids;
    } else if ('collectionId' in sel) {
        where = 'collection_id = $1';
        param = sel.collectionId;
    } else {
        where = 'media_id = $1';
        param = sel.mediaId;
    }
    const d = await client.query<{ id: string; media_id: string | null; }>(`DELETE FROM gallery_items WHERE ${where} RETURNING id, media_id`, [param,],);
    const ids = d.rows.map((r,) => r.id);
    const mediaIds = d.rows.map((r,) => r.media_id).filter((m,): m is string => Boolean(m,),);
    const rows = d.rows.map((r,) => ({ id: r.id, mediaId: r.media_id, }));
    if (!ids.length) return { ids, mediaIds, rows, };
    await deleteItemDiscussions(client, ids,);
    return { ids, mediaIds, rows, };
}

/** Step 2 + 3 of `removeGalleryItems` (no-op where the discussions tables were never installed). */
async function deleteItemDiscussions(client: PoolClient, itemIds: string[],): Promise<void> {
    const t = await client.query<{ comments: string | null; threads: string | null; }>(
        `SELECT to_regclass('comments')::text AS comments, to_regclass('comment_threads')::text AS threads`,
    );
    if (t.rows[0]?.comments) {
        const c = await client.query<{ id: string; }>(
            `SELECT id FROM comments WHERE target_type = 'gallery_item' AND target_id::text = ANY($1::text[]) AND status <> 'deleted'`,
            [itemIds,],
        );
        if (c.rows.length) {
            const { setStatus, } = await import('../discussions/comments.js');
            for (const row of c.rows) await setStatus(row.id, 'deleted', client,);
        }
    }
    if (t.rows[0]?.threads) {
        await client.query(`DELETE FROM comment_threads WHERE target_type = 'gallery_item' AND target_id::text = ANY($1::text[])`, [itemIds,],);
    }
}

/** Remove one item; optionally delete its media from the library too. */
export async function remove(
    id: string, deleteMedia: boolean, ctx: AuditContext, forceMedia = false,
): Promise<{ removed: true; mediaDeleted: boolean; mediaKept: boolean; }> {
    const r = await transaction((client,) => removeGalleryItems(client, { ids: [id,], },),);
    if (!r.ids.length) throw new NotFoundError('Gallery item',);
    let outcome: MediaDeleteOutcome | null = null;
    if (deleteMedia && r.mediaIds[0]) outcome = await deleteMediaQuietly(r.mediaIds[0], ctx, forceMedia,);
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

/** One row of a bulk publish statement: only the PRESENT fields (an omitted field stays as it is). */
type PublishRow = Record<string, unknown>;

/**
 * The publish draft → the JSON rows of the two bulk statements. Existing items
 * (by `id`) carry only the fields their input had (`setClause` semantics); new
 * items (by `mediaId`) carry everything with defaults. `ord` = the item's
 * position in the draft.
 */
export function publishRows(keep: GallerySyncBody['items'], createdBy: string | null,): { updates: PublishRow[]; inserts: PublishRow[]; } {
    const updates: PublishRow[] = [];
    const inserts: PublishRow[] = [];
    keep.forEach((item, ord,) => {
        const p = cleanPatch(item,);
        if (item.id) {
            const row: PublishRow = { id: item.id, ord, };
            for (const [k, col,] of Object.entries(COLS,) as [Exclude<keyof GalleryItemPatch, 'access'>, string][]) {
                if (p[k] !== undefined) row[col] = p[k];
            }
            if (p.access) Object.assign(row, { access_enabled: p.access.enabled, access_roles: p.access.roles, access_tier_ids: p.access.tierIds, },);
            updates.push(row,);
        } else {
            const access = p.access ?? { enabled: false, roles: [], tierIds: [], };
            inserts.push({
                media_id: item.mediaId, ord, title: p.titleOverride ?? null, caption: p.captionOverride ?? null, tags: p.tags ?? [],
                visibility: p.visibility ?? 'inherit', min_tier_id: p.minTierId ?? null, comments: p.comments ?? 'inherit',
                anonymous_comments: p.anonymousComments ?? 'inherit', created_by: createdBy, collection_id: p.collectionId ?? null,
                access_enabled: access.enabled, access_roles: access.roles, access_tier_ids: access.tierIds, hidden_in_gallery: p.hiddenInGallery ?? false,
                is_featured: p.isFeatured ?? false,
            },);
        }
    },);
    return { updates, inserts, };
}

/** `e ? 'col'` = the field was sent; else the row keeps its value. */
const fieldOr = (col: string, value: string,) => `CASE WHEN e ? '${col}' THEN ${value} ELSE g.${col} END`;
const textArr = (col: string,) => `ARRAY(SELECT jsonb_array_elements_text(e->'${col}'))`;

export const BULK_UPDATE_SQL = `UPDATE gallery_items g SET
        sort_order = (e->>'ord')::int,
        title = ${fieldOr('title', `e->>'title'`,)},
        caption = ${fieldOr('caption', `e->>'caption'`,)},
        tags = ${fieldOr('tags', textArr('tags',),)},
        visibility = ${fieldOr('visibility', `e->>'visibility'`,)},
        min_tier_id = ${fieldOr('min_tier_id', `(e->>'min_tier_id')::uuid`,)},
        comments = ${fieldOr('comments', `e->>'comments'`,)},
        anonymous_comments = ${fieldOr('anonymous_comments', `e->>'anonymous_comments'`,)},
        collection_id = ${fieldOr('collection_id', `(e->>'collection_id')::uuid`,)},
        access_enabled = ${fieldOr('access_enabled', `(e->>'access_enabled')::boolean`,)},
        access_roles = ${fieldOr('access_roles', textArr('access_roles',),)},
        access_tier_ids = ${fieldOr('access_tier_ids', `${textArr('access_tier_ids',)}::uuid[]`,)},
        hidden_in_gallery = ${fieldOr('hidden_in_gallery', `(e->>'hidden_in_gallery')::boolean`,)},
        is_featured = ${fieldOr('is_featured', `(e->>'is_featured')::boolean`,)},
        updated_at = NOW()
    FROM jsonb_array_elements($1::jsonb) e
    WHERE g.id = (e->>'id')::uuid`;

export const BULK_INSERT_SQL = `INSERT INTO gallery_items (media_id, sort_order, title, caption, tags, visibility, min_tier_id, comments, anonymous_comments,
                                created_by, collection_id, access_enabled, access_roles, access_tier_ids, hidden_in_gallery, is_featured)
    SELECT (e->>'media_id')::uuid, (e->>'ord')::int, e->>'title', e->>'caption', ${textArr('tags',)}, e->>'visibility', (e->>'min_tier_id')::uuid,
           e->>'comments', e->>'anonymous_comments', (e->>'created_by')::uuid, (e->>'collection_id')::uuid, (e->>'access_enabled')::boolean,
           ${textArr('access_roles',)}, ${textArr('access_tier_ids',)}::uuid[], (e->>'hidden_in_gallery')::boolean,
           COALESCE((e->>'is_featured')::boolean, false)
      FROM jsonb_array_elements($1::jsonb) e
    ON CONFLICT (media_id) WHERE media_id IS NOT NULL DO UPDATE SET sort_order = EXCLUDED.sort_order, updated_at = NOW()
    RETURNING (xmax = 0) AS inserted`;

/**
 * C4: refuse a publish built from an older gallery. Another editor (or tab)
 * that published, edited, added or removed items moves the newest
 * `updated_at` or the count; replacing the whole order + every field from an
 * hours-old draft would silently undo their work. 409 GALLERY_CHANGED, so the
 * admin can offer "reload / publish anyway" (`overwrite`).
 */
export async function assertUnchangedSince(basedOn: NonNullable<GallerySyncBody['basedOn']>,): Promise<void> {
    const r = await query<{ n: number; latest: Date | null; }>(`SELECT COUNT(*)::int AS n, MAX(updated_at) AS latest FROM gallery_items`,);
    const n = Number(r.rows[0]?.n ?? 0,);
    const latest = r.rows[0]?.latest ? new Date(r.rows[0].latest,).getTime() : null;
    const based = basedOn.updatedAt ? Date.parse(basedOn.updatedAt,) : null;
    // Timestamps go through JSON (ms precision); Postgres keeps µs — allow 1 ms.
    const newer = latest !== null && (based === null || latest > based + 1);
    if (newer || n !== basedOn.count) {
        throw new AppError(409, 'GALLERY_CHANGED', 'The gallery was changed by someone else since you loaded it. Reload to see their changes, or publish anyway to replace them.', {
            count: n, updatedAt: latest !== null ? new Date(latest,).toISOString() : null,
        },);
    }
}

/**
 * Publish the admin's draft: the ordered list of items to keep (existing by
 * `id`, new by `mediaId`) + removals, in one transaction. Media deletions
 * (removals with `deleteMedia`) run after the commit — they touch storage.
 */
export async function sync(body: GallerySyncBody, ctx: AuditContext,): Promise<GallerySyncResponse> {
    const s = await getSettings();
    if (body.basedOn && !body.overwrite) await assertUnchangedSince(body.basedOn,);
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
        if (removals.length) {
            const gone = await removeGalleryItems(client, { ids: removals.map((r,) => r.id,), },);
            removedCount = gone.ids.length;
            const withMedia = new Set(removals.filter((r,) => r.deleteMedia,).map((r,) => r.id,),);
            for (const row of gone.rows) if (withMedia.has(row.id,) && row.mediaId) mediaToDelete.push(row.mediaId,);
        }
        // P2: two statements for the whole draft, not one (or two) per item.
        const { updates, inserts, } = publishRows(keep, uuidOrNull(ctx.userId,),);
        if (updates.length) {
            const u = await client.query(BULK_UPDATE_SQL, [JSON.stringify(updates,),],);
            updated += u.rowCount ?? 0;
        }
        if (inserts.length) {
            const ins = await client.query<{ inserted: boolean; }>(BULK_INSERT_SQL, [JSON.stringify(inserts,),],);
            for (const r of ins.rows) {
                if (r.inserted) added += 1;
                // Already in the gallery (published elsewhere meanwhile) → only its place moved.
                else updated += 1;
            }
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
