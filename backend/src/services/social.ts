import type { SocialPlatform, SocialPost, } from '@surge/shared';
import { config, } from '../config';
import { query, } from '../db';
import { logger, } from '../utils/logger';

interface FetchedPost {
    id: string;
    content?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    authorName?: string;
    authorAvatar?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    publishedAt: Date;
    rawData: Record<string, unknown>;
}

export async function fetchYouTubeVideos(maxResults = 10,): Promise<FetchedPost[]> {
    if (!config.social.youtube.apiKey || !config.social.youtube.channelId) {
        logger.warn('YouTube configuration not set',);
        return [];
    }

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?key=${config.social.youtube.apiKey}&channelId=${config.social.youtube.channelId}&part=snippet&order=date&maxResults=${maxResults}&type=video`,
        );

        if (!response.ok) {
            throw new Error(`YouTube API error: ${response.statusText}`,);
        }

        const data = await response.json() as any;

        return data.items.map((item: Record<string, unknown>,) => {
            const snippet = item.snippet as Record<string, unknown>;
            const id = (item.id as Record<string, unknown>).videoId as string;

            return {
                id,
                content: snippet.title as string,
                mediaUrl: `https://www.youtube.com/watch?v=${id}`,
                thumbnailUrl: (snippet.thumbnails as Record<string, Record<string, string>>)?.high?.url,
                authorName: snippet.channelTitle as string,
                publishedAt: new Date(snippet.publishedAt as string,),
                rawData: item,
            };
        },);
    } catch (error) {
        logger.error('Error fetching YouTube videos', { error, },);
        return [];
    }
}

export async function fetchTwitterPosts(maxResults = 10,): Promise<FetchedPost[]> {
    if (!config.social.twitter.bearerToken || !config.social.twitter.username) {
        logger.warn('Twitter configuration not set',);
        return [];
    }

    try {
        // First get user ID
        const userResponse = await fetch(
            `https://api.twitter.com/2/users/by/username/${config.social.twitter.username}`,
            {
                headers: { Authorization: `Bearer ${config.social.twitter.bearerToken}`, },
            },
        );

        if (!userResponse.ok) {
            throw new Error(`Twitter API error: ${userResponse.statusText}`,);
        }

        const userData = await userResponse.json() as any;
        const userId = userData.data.id;

        // Get tweets
        const tweetsResponse = await fetch(
            `https://api.twitter.com/2/users/${userId}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics,attachments&expansions=attachments.media_keys&media.fields=url,preview_image_url`,
            {
                headers: { Authorization: `Bearer ${config.social.twitter.bearerToken}`, },
            },
        );

        if (!tweetsResponse.ok) {
            throw new Error(`Twitter API error: ${tweetsResponse.statusText}`,);
        }

        const tweetsData = await tweetsResponse.json() as any;
        const mediaMap = new Map<string, string>();

        if (tweetsData.includes?.media) {
            for (const media of tweetsData.includes.media) {
                mediaMap.set(media.media_key, media.url || media.preview_image_url,);
            }
        }

        return (tweetsData.data || []).map((tweet: Record<string, unknown>,) => {
            const metrics = tweet.public_metrics as Record<string, number> || {};
            const attachments = tweet.attachments as Record<string, string[]> || {};
            const mediaKey = attachments.media_keys?.[0];

            return {
                id: tweet.id as string,
                content: tweet.text as string,
                mediaUrl: mediaKey ? mediaMap.get(mediaKey,) : undefined,
                authorName: config.social.twitter.username,
                likes: metrics.like_count,
                comments: metrics.reply_count,
                shares: metrics.retweet_count,
                publishedAt: new Date(tweet.created_at as string,),
                rawData: tweet,
            };
        },);
    } catch (error) {
        logger.error('Error fetching Twitter posts', { error, },);
        return [];
    }
}

export async function fetchInstagramPosts(maxResults = 10,): Promise<FetchedPost[]> {
    if (!config.social.facebook.accessToken || !config.social.instagram.businessAccountId) {
        logger.warn('Instagram configuration not set',);
        return [];
    }

    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${config.social.instagram.businessAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink&limit=${maxResults}&access_token=${config.social.facebook.accessToken}`,
        );

        if (!response.ok) {
            throw new Error(`Instagram API error: ${response.statusText}`,);
        }

        const data = await response.json() as any;

        return (data.data || []).map((post: Record<string, unknown>,) => ({
            id: post.id as string,
            content: post.caption as string,
            mediaUrl: post.permalink as string,
            thumbnailUrl: (post.thumbnail_url || post.media_url) as string,
            likes: post.like_count as number,
            comments: post.comments_count as number,
            publishedAt: new Date(post.timestamp as string,),
            rawData: post,
        }));
    } catch (error) {
        logger.error('Error fetching Instagram posts', { error, },);
        return [];
    }
}

export async function fetchFacebookPosts(maxResults = 10,): Promise<FetchedPost[]> {
    if (!config.social.facebook.accessToken || !config.social.facebook.pageId) {
        logger.warn('Facebook configuration not set',);
        return [];
    }

    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${config.social.facebook.pageId}/posts?fields=id,message,created_time,full_picture,reactions.summary(true),comments.summary(true),shares&limit=${maxResults}&access_token=${config.social.facebook.accessToken}`,
        );

        if (!response.ok) {
            throw new Error(`Facebook API error: ${response.statusText}`,);
        }

        const data = await response.json() as any;

        return (data.data || []).map((post: Record<string, unknown>,) => ({
            id: post.id as string,
            content: post.message as string,
            mediaUrl: `https://www.facebook.com/${post.id}`,
            thumbnailUrl: post.full_picture as string,
            likes: (post.reactions as Record<string, Record<string, number>>)?.summary?.total_count,
            comments: (post.comments as Record<string, Record<string, number>>)?.summary?.total_count,
            shares: (post.shares as Record<string, number>)?.count,
            publishedAt: new Date(post.created_time as string,),
            rawData: post,
        }));
    } catch (error) {
        logger.error('Error fetching Facebook posts', { error, },);
        return [];
    }
}

export async function syncSocialPosts(platform: SocialPlatform,): Promise<number> {
    let posts: FetchedPost[] = [];

    switch (platform) {
        case 'youtube':
            posts = await fetchYouTubeVideos();
            break;
        case 'twitter':
            posts = await fetchTwitterPosts();
            break;
        case 'instagram':
            posts = await fetchInstagramPosts();
            break;
        case 'facebook':
            posts = await fetchFacebookPosts();
            break;
        default:
            logger.warn(`Unsupported platform: ${platform}`,);
            return 0;
    }

    let synced = 0;

    for (const post of posts) {
        try {
            await query(
                `INSERT INTO social_posts (platform, external_id, content, media_url, thumbnail_url,
                                   author_name, author_avatar, likes, comments, shares,
                                   published_at, fetched_at, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
         ON CONFLICT (platform, external_id) DO UPDATE SET
           content = EXCLUDED.content,
           media_url = EXCLUDED.media_url,
           thumbnail_url = EXCLUDED.thumbnail_url,
           likes = EXCLUDED.likes,
           comments = EXCLUDED.comments,
           shares = EXCLUDED.shares,
           fetched_at = NOW(),
           raw_data = EXCLUDED.raw_data`,
                [
                    platform,
                    post.id,
                    post.content,
                    post.mediaUrl,
                    post.thumbnailUrl,
                    post.authorName,
                    post.authorAvatar,
                    post.likes,
                    post.comments,
                    post.shares,
                    post.publishedAt,
                    JSON.stringify(post.rawData,),
                ],
            );
            synced++;
        } catch (error) {
            logger.error('Error syncing social post', { platform, postId: post.id, error, },);
        }
    }

    logger.info(`Synced ${synced} posts from ${platform}`,);
    return synced;
}

export async function syncAllPlatforms(): Promise<Record<SocialPlatform, number>> {
    const results: Partial<Record<SocialPlatform, number>> = {};

    const platforms: SocialPlatform[] = ['youtube', 'twitter', 'instagram', 'facebook',];

    for (const platform of platforms) {
        results[platform] = await syncSocialPosts(platform,);
    }

    return results as Record<SocialPlatform, number>;
}

export async function getSocialPosts(
    platform?: SocialPlatform,
    limit = 20,
    offset = 0,
): Promise<SocialPost[]> {
    let whereClause = '';
    const params: unknown[] = [];

    if (platform) {
        params.push(platform,);
        whereClause = `WHERE platform = $${params.length}`;
    }

    params.push(limit, offset,);
    const result = await query(
        `SELECT * FROM social_posts ${whereClause}
     ORDER BY published_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    return result.rows.map((row,) => ({
        id: row.id,
        platform: row.platform,
        externalId: row.external_id,
        content: row.content,
        mediaUrl: row.media_url,
        thumbnailUrl: row.thumbnail_url,
        authorName: row.author_name,
        authorAvatar: row.author_avatar,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        publishedAt: row.published_at,
        fetchedAt: row.fetched_at,
        rawData: row.raw_data,
    }));
}
