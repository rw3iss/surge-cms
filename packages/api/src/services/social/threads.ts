/**
 * Threads posts in `social_posts` — ANALYTICS ONLY.
 *
 * Threads is not a feed provider (no `SocialPlatform` arm, no public
 * renderer), so its rows are stored HIDDEN: they exist so the analytics
 * runner can attach per-post metrics (it maps PostMetric.externalId → the
 * social_posts row of the same platform). Hidden rows are left out of every
 * public read (getSocialPosts, homepage, platform listings).
 */
import { query, } from '../../db';
import { isOwnThread, parseThreadsTime, type ThreadsMedia, threadKind, } from './analytics/collectors/threadsMapping';

/** Insert / refresh the account's own threads. Returns how many were written. */
export async function upsertThreadsPosts(items: ThreadsMedia[],): Promise<number> {
    let written = 0;
    for (const m of items) {
        if (!m.id || !isOwnThread(m,)) continue;
        await query(
            `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url, author_name,
                    published_at, fetched_at, raw_data, source, post_url, media_kind, is_hidden)
             VALUES ('threads', $1, $2, $3, $4, $5, $6, NOW(), $7, 'sync', $8, $9, true)
             ON CONFLICT (platform, external_id) DO UPDATE SET
               content = EXCLUDED.content,
               media_url = COALESCE(EXCLUDED.media_url, social_posts.media_url),
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_posts.thumbnail_url),
               post_url = COALESCE(EXCLUDED.post_url, social_posts.post_url),
               published_at = COALESCE(EXCLUDED.published_at, social_posts.published_at),
               media_kind = EXCLUDED.media_kind,
               raw_data = EXCLUDED.raw_data,
               fetched_at = NOW()`,
            [
                m.id,
                m.text ?? null,
                m.media_url ?? null,
                m.thumbnail_url ?? null,
                m.username ?? null,
                parseThreadsTime(m.timestamp,),
                JSON.stringify(m,),
                m.permalink ?? null,
                threadKind(m,),
            ],
        );
        written++;
    }
    return written;
}
