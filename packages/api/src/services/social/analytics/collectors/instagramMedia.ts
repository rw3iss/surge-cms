/**
 * Instagram media discovery for analytics: list the account's media and live
 * stories, and keep social_posts in step so every item has a row the metrics
 * attach to (the feed sync only captures the newest few).
 *
 * - New posts are inserted visible (they sort by date, so older ones land deep
 *   in the feed history); an existing row keeps its feed curation (hidden,
 *   order) — only the content/counters refresh.
 * - Stories are inserted HIDDEN (kind 'story'): they expire after 24 h and
 *   are not feed content.
 * - Instagram media URLs are signed and expire, so a thumbnail is mirrored to
 *   our storage once (the feed sync's mirrorRemoteMedia); a row that already
 *   has a mirrored thumbnail is not downloaded again.
 */
import { query, } from '../../../../db';
import type { InstagramAuth, } from './instagram';
import { igPostKind, } from './instagramMapping';
import { graphGet, } from './metaGraph';

export interface IgMedia {
    id: string;
    caption?: string;
    media_type?: string;
    media_product_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
    like_count?: number;
    comments_count?: number;
    username?: string;
}

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username';
const DAY = 86_400_000;
/** Keep paging until items are older than this AND at least MIN_ITEMS are listed. */
export const MEDIA_DAYS = 90;
export const MIN_ITEMS = 25;
export const MAX_PAGES = 6;

const ts = (t?: string,) => Date.parse(String(t ?? '',).replace(/\+0000$/, 'Z',),);

/** Should listing stop after this page? (pure) */
export function listingDone(items: IgMedia[], now: number,): boolean {
    if (items.length < MIN_ITEMS) return false;
    const last = items[items.length - 1];
    const t = ts(last?.timestamp,);
    return Number.isFinite(t,) && now - t > MEDIA_DAYS * DAY;
}

/** The account's media, newest first (paged by cursor). */
export async function listMedia(auth: InstagramAuth,): Promise<IgMedia[]> {
    const items: IgMedia[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
        const r = await graphGet<{ data?: IgMedia[]; paging?: { cursors?: { after?: string; }; next?: string; }; }>(
            auth.base, `${auth.userId}/media`, { fields: MEDIA_FIELDS, limit: '50', ...(after ? { after, } : {}), }, auth.token,
        );
        items.push(...(r.data ?? []),);
        after = r.paging?.cursors?.after;
        if (!r.paging?.next || !after || listingDone(items, Date.now(),)) break;
    }
    return items;
}

/** Live stories (the last 24 h). */
export async function listStories(auth: InstagramAuth,): Promise<IgMedia[]> {
    const r = await graphGet<{ data?: IgMedia[]; }>(auth.base, `${auth.userId}/stories`, { fields: MEDIA_FIELDS, }, auth.token,);
    return (r.data ?? []).map((s,) => ({ ...s, media_product_type: s.media_product_type ?? 'STORY', }));
}

const EPHEMERAL = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)(?::|\/|$)|scontent/i;

/** Upsert media into social_posts (see the file header for the rules). Returns how many rows. */
export async function upsertInstagramMedia(items: IgMedia[],): Promise<number> {
    if (!items.length) return 0;
    const ids = items.map((i,) => i.id);
    const existing = await query<{ external_id: string; thumbnail_url: string | null; }>(
        `SELECT external_id, thumbnail_url FROM social_posts WHERE platform = 'instagram' AND external_id = ANY($1::text[])`,
        [ids,],
    );
    const mirrored = new Map(existing.rows.map((r,) => [r.external_id, r.thumbnail_url,]),);
    const { mirrorRemoteMedia, } = await import('../../../social.js');
    let n = 0;
    for (const m of items) {
        const kind = igPostKind(m,);
        const story = kind === 'story';
        const have = mirrored.get(m.id,);
        let thumb: string | null = have && !EPHEMERAL.test(have,) ? have : null;
        if (!thumb) {
            const src = m.thumbnail_url || m.media_url;
            thumb = src ? (await mirrorRemoteMedia(src, 'instagram', m.id,).catch(() => src,)) ?? null : null;
        }
        const published = Number.isFinite(ts(m.timestamp,),) ? new Date(ts(m.timestamp,),) : null;
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, author_name, likes, comments,
                    published_at, fetched_at, raw_data, source, post_url, media_kind, is_hidden)
             VALUES ('instagram', $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, 'sync', $3, $10, $11)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = COALESCE(EXCLUDED.content, social_posts.content),
               post_url = COALESCE(EXCLUDED.post_url, social_posts.post_url),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_posts.thumbnail_url),
               likes = COALESCE(EXCLUDED.likes, social_posts.likes),
               comments = COALESCE(EXCLUDED.comments, social_posts.comments),
               published_at = COALESCE(social_posts.published_at, EXCLUDED.published_at),
               media_kind = COALESCE(social_posts.media_kind, EXCLUDED.media_kind),
               fetched_at = NOW()`,
            [m.id, m.caption ?? null, m.permalink ?? null, thumb, m.username ?? null, m.like_count ?? null, m.comments_count ?? null,
                published, JSON.stringify({ ...m, mediaKind: kind, },), kind, story,],
        );
        n++;
    }
    return n;
}

