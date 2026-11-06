/**
 * Facebook Page post discovery for analytics (basic tier — a Page token with
 * pages_read_engagement is enough): list the Page's published posts and reels
 * and keep social_posts in step so every item has a row the metrics attach to
 * (the feed sync only captures the newest few).
 *
 * - New posts are inserted visible; an existing row keeps its feed curation
 *   (hidden, order) — only content and counters refresh.
 * - full_picture is an fbcdn URL that expires, so a thumbnail is mirrored to
 *   our storage once (social.ts mirrorRemoteMedia); a row that already has a
 *   mirrored thumbnail is not downloaded again.
 * - A reel is keyed by its Page post id when Graph gives one (so it merges
 *   with the same item from the posts list), else `<pageId>_<videoId>`.
 */
import { query, } from '../../../../db';
import { type FbPostNode, fbPostKind, } from './facebookMapping';
import { FACEBOOK_GRAPH, graphGet, isMetricError, } from './metaGraph';

export interface FbPage {
    id: string;
    token: string;
}

export interface FbReel {
    id: string;
    post_id?: string;
    description?: string;
    created_time?: string;
    updated_time?: string;
    permalink_url?: string;
    picture?: string;
    length?: number;
}

/** A listed item ready for the upsert + metrics. */
export interface FbItem {
    externalId: string;
    kind: string;
    videoId: string | null;
    node: FbPostNode;
}

export const POST_FIELDS = 'id,message,created_time,permalink_url,full_picture,status_type,'
    + 'attachments{media_type,type,url,media,target},shares,'
    + 'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
const REEL_FIELDS = 'id,post_id,description,created_time,updated_time,permalink_url,picture,length';
const REEL_FIELDS_MIN = 'id,description,updated_time';

const DAY = 86_400_000;
export const POST_DAYS = 90;
export const MIN_ITEMS = 25;
export const MAX_PAGES = 6;

const ts = (t?: string,) => Date.parse(String(t ?? '',).replace(/\+0000$/, 'Z',),);

/** Should listing stop after this page? (pure) */
export function listingDone(items: Array<{ created_time?: string; }>, now: number,): boolean {
    if (items.length < MIN_ITEMS) return false;
    const t = ts(items[items.length - 1]?.created_time,);
    return Number.isFinite(t,) && now - t > POST_DAYS * DAY;
}

type Paged<T,> = { data?: T[]; paging?: { cursors?: { after?: string; }; next?: string; }; };

async function pageThrough<T extends { created_time?: string; },>(path: string, fields: string, page: FbPage,): Promise<T[]> {
    const items: T[] = [];
    let after: string | undefined;
    for (let n = 0; n < MAX_PAGES; n++) {
        const r = await graphGet<Paged<T>>(FACEBOOK_GRAPH, path, { fields, limit: '50', ...(after ? { after, } : {}), }, page.token,);
        items.push(...(r.data ?? []),);
        after = r.paging?.cursors?.after;
        if (!r.paging?.next || !after || listingDone(items, Date.now(),)) break;
    }
    return items;
}

/** The Page's posts, newest first: /published_posts, else /posts (older tokens / app tokens). */
export async function listPosts(page: FbPage,): Promise<FbPostNode[]> {
    try {
        return await pageThrough<FbPostNode>(`${page.id}/published_posts`, POST_FIELDS, page,);
    } catch (e) {
        if (!isMetricError(e,)) throw e;
        return pageThrough<FbPostNode>(`${page.id}/posts`, POST_FIELDS, page,);
    }
}

/** The Page's reels (/video_reels); a field Graph refuses → retried with the minimal field set. */
export async function listReels(page: FbPage,): Promise<FbReel[]> {
    try {
        return await pageThrough<FbReel>(`${page.id}/video_reels`, REEL_FIELDS, page,);
    } catch (e) {
        if (!isMetricError(e,)) throw e;
        return pageThrough<FbReel>(`${page.id}/video_reels`, REEL_FIELDS_MIN, page,);
    }
}

/** Posts + reels → one item per Page post (pure; a reel already in the posts list is merged, not duplicated). */
export function mergeItems(pageId: string, posts: FbPostNode[], reels: FbReel[],): FbItem[] {
    const out = new Map<string, FbItem>();
    for (const p of posts) {
        out.set(p.id, { externalId: p.id, kind: fbPostKind(p,), videoId: p.attachments?.data?.[0]?.target?.id ?? null, node: p, },);
    }
    const byVideo = new Map<string, FbItem>();
    for (const item of out.values()) if (item.videoId) byVideo.set(item.videoId, item,);
    for (const r of reels) {
        const known = (r.post_id && out.get(r.post_id,)) || byVideo.get(r.id,);
        if (known) {
            known.kind = 'reel';
            known.videoId = r.id;
            continue;
        }
        const externalId = r.post_id || `${pageId}_${r.id}`;
        out.set(externalId, {
            externalId,
            kind: 'reel',
            videoId: r.id,
            node: {
                id: externalId,
                message: r.description,
                created_time: r.created_time ?? r.updated_time,
                permalink_url: r.permalink_url ? new URL(r.permalink_url, 'https://www.facebook.com',).toString() : undefined,
                full_picture: r.picture,
            },
        },);
    }
    return [...out.values(),];
}

const EPHEMERAL = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)(?::|\/|$)|scontent/i;

/** Upsert items into social_posts (see the file header). Returns how many rows. */
export async function upsertFacebookPosts(items: FbItem[],): Promise<number> {
    if (!items.length) return 0;
    const existing = await query<{ external_id: string; thumbnail_url: string | null; }>(
        `SELECT external_id, thumbnail_url FROM social_posts WHERE platform = 'facebook' AND external_id = ANY($1::text[])`,
        [items.map((i,) => i.externalId),],
    );
    const mirrored = new Map(existing.rows.map((r,) => [r.external_id, r.thumbnail_url,]),);
    const { mirrorRemoteMedia, } = await import('../../../social.js');
    let n = 0;
    for (const item of items) {
        const p = item.node;
        const have = mirrored.get(item.externalId,);
        let thumb: string | null = have && !EPHEMERAL.test(have,) ? have : null;
        if (!thumb) {
            const src = p.full_picture || p.attachments?.data?.[0]?.media?.image?.src;
            thumb = src ? (await mirrorRemoteMedia(src, 'facebook', item.externalId,).catch(() => src,)) ?? null : null;
        }
        const published = Number.isFinite(ts(p.created_time,),) ? new Date(ts(p.created_time,),) : null;
        const url = p.permalink_url || `https://www.facebook.com/${item.externalId}`;
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, likes, comments, shares,
                    published_at, fetched_at, raw_data, source, post_url, media_kind, is_hidden)
             VALUES ('facebook', $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, 'sync', $3, $10, false)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = COALESCE(EXCLUDED.content, social_posts.content),
               post_url = COALESCE(EXCLUDED.post_url, social_posts.post_url),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_posts.thumbnail_url),
               likes = COALESCE(EXCLUDED.likes, social_posts.likes),
               comments = COALESCE(EXCLUDED.comments, social_posts.comments),
               shares = COALESCE(EXCLUDED.shares, social_posts.shares),
               published_at = COALESCE(social_posts.published_at, EXCLUDED.published_at),
               media_kind = COALESCE(social_posts.media_kind, EXCLUDED.media_kind),
               fetched_at = NOW()`,
            [item.externalId, p.message ?? null, url, thumb, p.reactions?.summary?.total_count ?? null,
                p.comments?.summary?.total_count ?? null, p.shares?.count ?? null, published,
                JSON.stringify({ ...p, mediaKind: item.kind, videoId: item.videoId, },), item.kind,],
        );
        n++;
    }
    return n;
}
