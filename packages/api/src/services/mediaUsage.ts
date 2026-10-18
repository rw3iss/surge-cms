/**
 * Where is a media item used? — the "in use" guard behind media deletes.
 *
 * Content references media two ways, and both are scanned:
 *   - by ID: block settings (`mediaId`, `images[].mediaId`, …), `gallery_items.media_id`,
 *     `shop_product_media.media_id`, a video's `/api/v1/video/<id>/…` URLs,
 *     `posts.type_settings.recordingMediaId`, custom-entity `media` fields;
 *   - by URL: content stores image URLs ABSOLUTE (any host — the storage endpoint,
 *     the CDN, a host-relative `/uploads/…`). The file name is the stable part
 *     (nanoid-generated), so the needle is `/<file name>` for the file and for its
 *     thumbnail; the leading slash keeps `x.jpg` from matching `thumb_x.jpg`.
 *
 * Each source is ONE query: the needles are unnested into `n(media_id, pat)` and
 * joined with `LIKE` against the source's text/JSONB columns (`jsonb::text`), so
 * a batch of media costs one scan per table, not one per media. A source whose
 * table is missing (feature never installed) is skipped; any other failure is
 * logged and skipped — the guard degrades, it never blocks a page from loading.
 */
import type { MediaUsage, MediaUsageKind, MediaUsageResponse, } from '@sitesurge/types';
import { query, } from '../db';
import { AppError, } from '../core/errors';
import { logger, } from '../utils/logger';
import { snakeCase, } from '../entities/columnMap';
import { urlPath, } from './mediaRefs';

/** Usages kept per media item (the confirm dialog shows a handful + "…and N more"). */
export const USAGE_CAP = 20;

export interface MediaNeedleSource {
    id: string;
    url?: string | null;
    thumbnail_url?: string | null;
}

/** `%`, `_` and `\` are LIKE wildcards/escape — nanoid file names contain `_`. */
export function likeEscape(s: string,): string {
    return s.replace(/[\\%_]/g, (c,) => `\\${c}`,);
}

/** `/uploads/abc123XYZ.jpg?x=1` → `/abc123XYZ.jpg`, or null when the name is too
 *  generic to match safely (no extension, very short — e.g. a video's `/file`). */
export function fileNeedle(u: string | null | undefined,): string | null {
    if (!u || typeof u !== 'string') return null;
    const p = urlPath(u.trim(),);
    const name = p.slice(p.lastIndexOf('/',) + 1,);
    if (!/^[^/]{6,}\.[a-z0-9]{2,5}$/i.test(name,)) return null;
    return `/${name}`;
}

/** Every raw string that marks a use of this media item. */
export function mediaNeedles(m: MediaNeedleSource,): string[] {
    const out = new Set<string>([m.id,],);
    for (const u of [m.url, m.thumbnail_url,]) {
        const n = fileNeedle(u,);
        if (n) out.add(n,);
    }
    return [...out,];
}

/** Parallel arrays for `unnest($1::text[], $2::text[]) AS n(media_id, pat)`. */
export function buildPatterns(media: MediaNeedleSource[],): { ids: string[]; pats: string[]; } {
    const ids: string[] = [];
    const pats: string[] = [];
    for (const m of media) {
        for (const needle of mediaNeedles(m,)) {
            ids.push(m.id,);
            pats.push(`%${likeEscape(needle,)}%`,);
        }
    }
    return { ids, pats, };
}

/** Row shape every source query returns. */
export interface UsageRow {
    media_id: string;
    id: string;
    label: string | null;
    field: string | null;
    extra: string | null;
}

interface Source {
    name: string;
    sql: string;
    toUsage(row: UsageRow,): Omit<MediaUsage, 'field'> & { field?: string; };
}

const N = `n AS (SELECT * FROM unnest($1::text[], $2::text[]) AS n(media_id, pat))`;

const SETTINGS_KIND: Record<string, { kind: MediaUsageKind; label: string; url: string; }> = {
    site_header: { kind: 'header', label: 'Site header', url: '/admin/settings?tab=site-header', },
    site_footer: { kind: 'footer', label: 'Site footer', url: '/admin/settings?tab=site-footer', },
    site_branding: { kind: 'site_settings', label: 'Site branding', url: '/admin/settings', },
    site_appearance: { kind: 'site_settings', label: 'Appearance', url: '/admin/settings?tab=appearance', },
    gallery_settings: { kind: 'site_settings', label: 'Gallery settings', url: '/admin/gallery/settings', },
    shop_settings: { kind: 'site_settings', label: 'Shop settings', url: '/admin/shop/settings', },
    shop_appearance: { kind: 'site_settings', label: 'Shop appearance', url: '/admin/shop/settings', },
};

const trashed = (label: string | null, status: string | null,): string =>
    `${label || 'Untitled'}${status === 'deleted' ? ' (in trash)' : ''}`;

const blockField = (type: string | null,): string => `Content block${type ? ` (${type.replace(/_/g, ' ',)})` : ''}`;

export const SOURCES: Source[] = [
    {
        name: 'page blocks',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, p.id::text AS id, p.title AS label, b.type::text AS field, p.status::text AS extra
                FROM blocks b JOIN pages p ON p.id = b.page_id
                JOIN n ON concat_ws(' ', b.settings::text, b.style::text, b.content) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'page', id: r.id, label: trashed(r.label, r.extra,), adminUrl: `/admin/pages/${r.id}`, field: blockField(r.field,), }),
    },
    {
        name: 'pages',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, p.id::text AS id, p.title AS label,
                     CASE WHEN p.og_image LIKE n.pat THEN 'Social image' ELSE 'Custom CSS' END AS field, p.status::text AS extra
                FROM pages p JOIN n ON concat_ws(' ', p.og_image, p.custom_css) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'page', id: r.id, label: trashed(r.label, r.extra,), adminUrl: `/admin/pages/${r.id}`, }),
    },
    {
        name: 'posts',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, p.id::text AS id, p.title AS label,
                     CASE WHEN p.featured_image LIKE n.pat THEN 'Featured image'
                          WHEN p.type_settings::text LIKE n.pat THEN 'Live recording'
                          WHEN p.custom_css LIKE n.pat THEN 'Custom CSS'
                          ELSE 'Body' END AS field, p.status::text AS extra
                FROM posts p JOIN n ON concat_ws(' ', p.featured_image, p.content, p.custom_css, p.type_settings::text) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'post', id: r.id, label: trashed(r.label, r.extra,), adminUrl: `/admin/posts/${r.id}`, }),
    },
    {
        name: 'post blocks',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, p.id::text AS id, p.title AS label, b.type::text AS field, p.status::text AS extra
                FROM post_content_blocks b JOIN posts p ON p.id = b.post_id
                JOIN n ON concat_ws(' ', b.data::text, b.style::text, b.media_url) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'post', id: r.id, label: trashed(r.label, r.extra,), adminUrl: `/admin/posts/${r.id}`, field: blockField(r.field,), }),
    },
    {
        name: 'campaigns',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, c.id::text AS id, c.title AS label,
                     CASE WHEN c.featured_image LIKE n.pat THEN 'Featured image' ELSE 'Description' END AS field, NULL AS extra
                FROM campaigns c JOIN n ON concat_ws(' ', c.featured_image, c.description, c.short_description) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'campaign', id: r.id, label: r.label || 'Untitled campaign', adminUrl: `/admin/campaigns/${r.id}`, }),
    },
    {
        name: 'events',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, e.id::text AS id, e.title AS label,
                     CASE WHEN e.featured_image LIKE n.pat THEN 'Featured image' ELSE 'Description' END AS field, NULL AS extra
                FROM events e JOIN n ON concat_ws(' ', e.featured_image, e.description, e.metadata::text) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'event', id: r.id, label: r.label || 'Untitled event', adminUrl: `/admin/events/${r.id}`, }),
    },
    {
        name: 'product media',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, sp.id::text AS id, sp.title AS label, 'Product media' AS field, NULL AS extra
                FROM shop_product_media pm JOIN shop_products sp ON sp.id = pm.product_id
                JOIN n ON pm.media_id = n.media_id::uuid OR pm.external_url LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'product', id: r.id, label: r.label || 'Untitled product', adminUrl: `/admin/shop/products/${r.id}`, }),
    },
    {
        name: 'products',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, sp.id::text AS id, sp.title AS label, 'Description' AS field, NULL AS extra
                FROM shop_products sp JOIN n ON sp.description LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'product', id: r.id, label: r.label || 'Untitled product', adminUrl: `/admin/shop/products/${r.id}`, }),
    },
    {
        // Id-keyed: compare the uuid (index on media_id), not LIKE over text.
        name: 'gallery items',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, gi.id::text AS id, NULLIF(gi.title, '') AS label, 'Gallery' AS field, NULL AS extra
                FROM gallery_items gi JOIN n ON gi.media_id = n.media_id::uuid`,
        toUsage: (r,) => ({ kind: 'gallery_item', id: r.id, label: r.label || 'Gallery item', adminUrl: '/admin/gallery', }),
    },
    {
        name: 'mail templates',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, t.id::text AS id, t.name AS label, b.block_type::text AS field, NULL AS extra
                FROM mail_template_blocks b JOIN mail_templates t ON t.id = b.template_id
                JOIN n ON concat_ws(' ', b.settings::text, b.style::text) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'mail_template', id: r.id, label: r.label || 'Mail template', adminUrl: `/admin/mail-templates/${r.id}`, field: blockField(r.field,), }),
    },
    {
        name: 'block templates',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, t.id::text AS id, t.name AS label, b.block_type::text AS field, t.entity_type_key AS extra
                FROM content_block_template_blocks b JOIN content_block_templates t ON t.id = b.template_id
                JOIN n ON concat_ws(' ', b.settings::text, b.style::text) LIKE n.pat`,
        toUsage: (r,) => (r.extra ?
            { kind: 'block_template', id: r.id, label: r.label || 'Template', adminUrl: `/admin/entities/${r.extra}/templates/${r.id}`, field: blockField(r.field,), } :
            { kind: 'component', id: r.id, label: r.label || 'Component', adminUrl: `/admin/components/${r.id}`, field: blockField(r.field,), }),
    },
    {
        name: 'site settings',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, s.key AS id, s.key AS label, NULL AS field, NULL AS extra
                FROM site_settings s JOIN n ON s.value::text LIKE n.pat`,
        toUsage: (r,) => {
            const known = SETTINGS_KIND[r.id];
            return known ?
                { kind: known.kind, id: r.id, label: known.label, adminUrl: known.url, field: 'Settings', } :
                { kind: 'site_settings', id: r.id, label: `Setting "${r.id}"`, adminUrl: '/admin/settings', field: 'Settings', };
        },
    },
    {
        name: 'social posts',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, sp.id::text AS id, left(coalesce(NULLIF(sp.content, ''), sp.post_url, 'Social post'), 60) AS label,
                     'Thumbnail' AS field, NULL AS extra
                FROM social_posts sp JOIN n ON concat_ws(' ', sp.thumbnail_url, sp.media_url) LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'social_post', id: r.id, label: r.label || 'Social post', adminUrl: '/admin/social', }),
    },
    {
        // The email as sent (what `/mail/:jobId` serves): deleting the file
        // breaks its image in the archive. Not content to edit — a warning.
        name: 'sent emails',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, j.id::text AS id, j.subject AS label, 'Archived email — will show a broken image' AS field, NULL AS extra
                FROM mail_send_jobs j JOIN n ON j.rendered_html_template LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'sent_email', id: r.id, label: `Sent email: ${r.label || 'Untitled'}`, adminUrl: `/admin/mail/jobs/${r.id}`, }),
    },
    {
        name: 'comments',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, c.id::text AS id, left(c.body, 60) AS label, c.target_type::text AS field, c.target_id::text AS extra
                FROM comments c JOIN n ON c.body LIKE n.pat
               WHERE c.status <> 'deleted'`,
        toUsage: (r,) => ({
            kind: 'comment', id: r.id, label: r.label || 'Comment',
            adminUrl: `/admin/comments?target=${encodeURIComponent(`${r.field}:${r.extra}`,)}`,
            field: r.field === 'forum_thread' ? 'Forum post' : 'Comment',
        }),
    },
    {
        name: 'users',
        sql: `WITH ${N}
              SELECT DISTINCT n.media_id, u.id::text AS id, coalesce(NULLIF(u.display_name, ''), u.email) AS label, 'Avatar' AS field, NULL AS extra
                FROM users u JOIN n ON u.avatar_url LIKE n.pat`,
        toUsage: (r,) => ({ kind: 'user', id: r.id, label: r.label || 'User', adminUrl: `/admin/users/${r.id}`, }),
    },
];

/** Field types on a custom entity that can hold a media id or URL. */
const ENTITY_SCAN_TYPES = new Set(['media', 'json', 'richtext', 'longtext', 'markdown', 'text',],);
const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * One source per CUSTOM entity type with a field that can hold media. Core types
 * (post/page/campaign/…) are covered by the bespoke sources above; an
 * admin-added field on a core type is not scanned.
 */
async function entitySources(): Promise<Source[]> {
    let types: Array<{ key: string; label: string; origin: string; tableName: string; fields: Array<{ key: string; label: string; type: string; }>; }> = [];
    try {
        const em = await import('../entities/entityManager.js');
        await em.ready();
        types = em.all() as typeof types;
    } catch (e) {
        logger.warn('media usage: entity types unavailable', { error: (e as Error).message, },);
        return [];
    }
    const out: Source[] = [];
    for (const t of types) {
        if (t.origin !== 'custom' || !SAFE_IDENT.test(t.tableName,)) continue;
        const fields = t.fields
            .filter((f,) => ENTITY_SCAN_TYPES.has(f.type,),)
            .map((f,) => ({ ...f, col: snakeCase(f.key,), }),)
            .filter((f,) => SAFE_IDENT.test(f.col,),);
        if (!fields.length) continue;
        const labelCol = fields.find((f,) => f.type === 'text',)?.col;
        const cols = fields.map((f,) => `e."${f.col}"::text`,).join(', ',);
        const whichField = `CASE ${fields.map((f,) => `WHEN e."${f.col}"::text LIKE n.pat THEN '${f.col}'`,).join(' ',)} END`;
        const labels = new Map(fields.map((f,) => [f.col, f.label,]),);
        out.push({
            name: `entity ${t.key}`,
            sql: `WITH ${N}
                  SELECT DISTINCT n.media_id, e.id::text AS id, ${labelCol ? `e."${labelCol}"::text` : 'NULL'} AS label, ${whichField} AS field, NULL AS extra
                    FROM "${t.tableName}" e JOIN n ON concat_ws(' ', ${cols}) LIKE n.pat`,
            toUsage: (r,) => ({
                kind: 'entity', id: r.id, label: `${t.label}: ${r.label || r.id}`,
                adminUrl: `/admin/entities/${t.key}/${r.id}`, field: (r.field && labels.get(r.field,)) || t.label,
            }),
        },);
    }
    return out;
}

/** Group rows into `{ mediaId: MediaUsage[] }` — de-duplicated (kind+id+field), capped. */
export function collectUsage(
    mediaIds: string[],
    results: Array<{ source: Pick<Source, 'toUsage'>; rows: UsageRow[]; }>,
    cap = USAGE_CAP,
): MediaUsageResponse {
    const out: MediaUsageResponse = {};
    const seen = new Map<string, Set<string>>();
    for (const id of mediaIds) {
        out[id] = [];
        seen.set(id, new Set(),);
    }
    for (const { source, rows, } of results) {
        for (const row of rows) {
            const list = out[row.media_id];
            if (!list || list.length >= cap) continue;
            const u = source.toUsage(row,);
            const usage: MediaUsage = { ...u, field: u.field ?? row.field ?? '', };
            const key = `${usage.kind}:${usage.id}:${usage.field}`;
            const s = seen.get(row.media_id,)!;
            if (s.has(key,)) continue;
            s.add(key,);
            list.push(usage,);
        }
    }
    return out;
}

/** Sources queried at once by `findMediaUsage`. */
export const USAGE_CONCURRENCY = 4;

/** `Promise.all(list.map(fn))` with at most `limit` running; results keep input order. */
export async function mapLimit<T, R,>(list: T[], limit: number, fn: (x: T,) => Promise<R>,): Promise<R[]> {
    const out: R[] = Array.from({ length: list.length, },);
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const i = next++;
            out[i] = await fn(list[i],);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, list.length,), }, worker,),);
    return out;
}

/** Postgres "undefined table/column" — the owning feature was never installed. */
const isMissingRelation = (e: unknown,): boolean => ['42P01', '42703',].includes((e as { code?: string; }).code ?? '',);

/**
 * Where each media item is used. Unknown ids answer with an empty list.
 * `exclude` drops usages the caller is deleting in the same act (e.g. the
 * gallery item whose media is being removed with it).
 */
export async function findMediaUsage(
    mediaIds: string[],
    opts: { excludeKinds?: MediaUsageKind[]; } = {},
): Promise<MediaUsageResponse> {
    const ids = [...new Set(mediaIds.filter((id,) => /^[0-9a-f-]{36}$/i.test(id,),),),];
    if (!ids.length) return {};
    const media = await query<MediaNeedleSource>(
        `SELECT id::text AS id, url, thumbnail_url FROM media WHERE id = ANY($1::uuid[])`,
        [ids,],
    );
    // Unknown ids still get an id needle — a block may hold the id of a media
    // item that is already gone, and there is nothing else to match on.
    const known = new Map(media.rows.map((m,) => [m.id, m,]),);
    const { ids: nIds, pats, } = buildPatterns(ids.map((id,) => known.get(id,) ?? { id, },),);
    const sources = [...SOURCES, ...(await entitySources()),];
    // At most USAGE_CONCURRENCY sources at once: each is a table scan, and
    // ~17 in parallel per check took most of the pool on a busy site.
    const results = await mapLimit(sources, USAGE_CONCURRENCY, async (source,) => {
        try {
            const r = await query<UsageRow>(source.sql, [nIds, pats,],);
            return { source, rows: r.rows, };
        } catch (e) {
            if (!isMissingRelation(e,)) logger.warn('media usage: source failed', { source: source.name, error: (e as Error).message, },);
            return { source, rows: [] as UsageRow[], };
        }
    },);
    const usage = collectUsage(ids, results,);
    if (opts.excludeKinds?.length) {
        const drop = new Set(opts.excludeKinds,);
        for (const id of Object.keys(usage,)) usage[id] = usage[id].filter((u,) => !drop.has(u.kind,),);
    }
    return usage;
}

/** Only the media ids that are in use (with their usages). */
export function inUseOnly(usage: MediaUsageResponse,): MediaUsageResponse {
    return Object.fromEntries(Object.entries(usage,).filter(([, list,],) => list.length > 0,),);
}

/** 409 `MEDIA_IN_USE` — `details.usage` lists where (same shape as GET /media/usage). */
export class MediaInUseError extends AppError {
    constructor(usage: MediaUsageResponse,) {
        const places = Object.values(usage,).reduce((n, l,) => n + l.length, 0,);
        super(409, 'MEDIA_IN_USE', `Media is still used in ${places} place${places === 1 ? '' : 's'}; pass force to delete anyway`, { usage, },);
        this.name = 'MediaInUseError';
    }
}

/** Throw `MediaInUseError` when any of the ids is in use. */
export async function assertNotInUse(mediaIds: string[], opts: { excludeKinds?: MediaUsageKind[]; } = {},): Promise<void> {
    const used = inUseOnly(await findMediaUsage(mediaIds, opts,),);
    if (Object.keys(used,).length) throw new MediaInUseError(used,);
}
