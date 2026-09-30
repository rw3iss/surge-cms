/**
 * Media behind a URL field — the full library record for a post banner, a
 * campaign image, an event image.
 *
 * Content stores its image as a URL (`featured_image`), not a media id, so the
 * record is found by URL. Media URLs are stored ABSOLUTE; a content field may
 * hold the same file host-relative (`/uploads/x.jpg`) — both forms match on
 * the path. A URL that is not in the library (pasted from elsewhere) still
 * gets a MediaRef with just `path`/`url`, so a template reading
 * `{{post.featuredImage.path}}` never has to care where the image came from.
 */
import type { MediaRef, } from '@sitesurge/types';
import { query, } from '../db';
import { logger, } from '../utils/logger';

/** `https://cdn.x/uploads/a.jpg` → `/uploads/a.jpg`; a relative URL is kept. */
export function urlPath(u: string,): string {
    return u.replace(/^https?:\/\/[^/]+/i, '',).split(/[?#]/,)[0];
}

interface MediaRow {
    id: string;
    url: string;
    thumbnail_url: string | null;
    title: string | null;
    caption: string | null;
    credits: string | null;
    alt: string | null;
    mime_type: string | null;
}

function toRef(row: MediaRow | null, url: string,): MediaRef {
    return {
        id: row?.id ?? null,
        path: url,
        url,
        thumbnailUrl: row?.thumbnail_url ?? null,
        title: row?.title ?? null,
        description: row?.caption ?? null,
        credits: row?.credits ?? null,
        alt: row?.alt ?? null,
        mimeType: row?.mime_type ?? null,
    };
}

/** Look up the media records for a set of URLs in ONE query. */
export async function mediaRefsFor(urls: string[],): Promise<Map<string, MediaRef>> {
    const out = new Map<string, MediaRef>();
    const unique = [...new Set(urls.filter((u,) => typeof u === 'string' && u.trim(),),),];
    if (!unique.length) return out;
    let rows: MediaRow[] = [];
    try {
        const paths = [...new Set(unique.map(urlPath,),),];
        const res = await query<MediaRow>(
            `SELECT id, url, thumbnail_url, title, caption, credits, alt, mime_type
               FROM media
              WHERE url = ANY($1::text[])
                 OR regexp_replace(split_part(url, '?', 1), '^https?://[^/]+', '') = ANY($2::text[])`,
            [unique, paths,],
        );
        rows = res.rows;
    } catch (err) {
        // A lookup failure must not break the page — fall back to bare refs.
        logger.warn('media ref lookup failed', { error: (err as Error).message, },);
    }
    const byUrl = new Map(rows.map((r,) => [r.url, r,]),);
    const byPath = new Map(rows.map((r,) => [urlPath(r.url,), r,]),);
    for (const u of unique) out.set(u, toRef(byUrl.get(u,) ?? byPath.get(urlPath(u,),) ?? null, u,),);
    return out;
}

/**
 * Attach `featuredMedia` to every record that has a `featuredImage` URL.
 * Mutates and returns the same objects (records are freshly mapped rows).
 */
export async function attachFeaturedMedia<T,>(records: T[],): Promise<T[]> {
    const recs = records as unknown as Array<Record<string, unknown>>;
    const urls = recs.map((r,) => r?.featuredImage,).filter((u,): u is string => typeof u === 'string' && !!u.trim(),);
    if (!urls.length) {
        for (const r of recs) if (r && 'featuredImage' in r) r.featuredMedia = null;
        return records;
    }
    const refs = await mediaRefsFor(urls,);
    for (const r of recs) {
        if (!r) continue;
        const u = r.featuredImage;
        r.featuredMedia = typeof u === 'string' && u.trim() ? refs.get(u,) ?? null : null;
    }
    return records;
}

/** Single-record convenience. */
export async function withFeaturedMedia<T,>(record: T,): Promise<T> {
    if (record) await attachFeaturedMedia([record,],);
    return record;
}
