/**
 * TikTok video discovery for analytics: TikTok has no feed fetcher, so the
 * listed videos (Display API or Business API) are UPSERTED into social_posts —
 * otherwise the runner could not map their metrics and the dashboard's post
 * table would stay empty.
 *
 * Cover images are signed tiktokcdn URLs that expire within hours, so a cover
 * is mirrored to our storage ONCE (the feed sync's mirrorRemoteMedia); a row
 * that already holds a mirrored cover is not downloaded again.
 */
import { query, } from '../../../../db';
import { type TikTokVideo, tiktokPostRow, } from './tiktokMapping';

const EPHEMERAL = /(?:^|\.)tiktokcdn(?:-[a-z]+)?\.com(?::|\/|$)/i;

/** Insert / refresh TikTok videos in social_posts. Returns how many rows. */
export async function upsertTikTokVideos(videos: TikTokVideo[], authorName: string | null = null,): Promise<number> {
    const list = videos.filter((v,) => v.id,);
    if (!list.length) return 0;
    const existing = await query<{ external_id: string; thumbnail_url: string | null; }>(
        `SELECT external_id, thumbnail_url FROM social_posts WHERE platform = 'tiktok' AND external_id = ANY($1::text[])`,
        [list.map((v,) => v.id),],
    );
    const have = new Map(existing.rows.map((r,) => [r.external_id, r.thumbnail_url,]),);
    const { mirrorRemoteMedia, } = await import('../../../social.js');
    let count = 0;
    for (const v of list) {
        const r = tiktokPostRow(v,);
        const prior = have.get(v.id,);
        let thumb: string | null = prior && !EPHEMERAL.test(prior,) ? prior : null;
        if (!thumb && r.thumbnailUrl) {
            thumb = (await mirrorRemoteMedia(r.thumbnailUrl, 'tiktok', v.id,).catch(() => r.thumbnailUrl,)) ?? null;
        }
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, author_name, likes, comments, shares,
                    published_at, fetched_at, raw_data, source, post_url, media_kind, duration_seconds)
             VALUES ('tiktok', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, 'sync', $3, 'video', $11)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = COALESCE(EXCLUDED.content, social_posts.content),
               media_url = COALESCE(EXCLUDED.media_url, social_posts.media_url),
               post_url = COALESCE(EXCLUDED.post_url, social_posts.post_url),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_posts.thumbnail_url),
               author_name = COALESCE(EXCLUDED.author_name, social_posts.author_name),
               likes = EXCLUDED.likes, comments = EXCLUDED.comments, shares = EXCLUDED.shares,
               published_at = COALESCE(social_posts.published_at, EXCLUDED.published_at),
               duration_seconds = COALESCE(EXCLUDED.duration_seconds, social_posts.duration_seconds),
               media_kind = COALESCE(social_posts.media_kind, EXCLUDED.media_kind),
               raw_data = EXCLUDED.raw_data, fetched_at = NOW()`,
            [r.externalId, r.content, r.postUrl, thumb, authorName, r.likes, r.comments, r.shares, r.publishedAt,
                JSON.stringify({ ...v, mediaKind: 'video', },), r.durationSeconds,],
        );
        count++;
    }
    return count;
}
