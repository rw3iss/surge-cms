/**
 * Shared shape for a fetched/hydrated social post, before it is upserted
 * into `social_posts`. Lives here (rather than in `social.ts`) so the
 * platform fetchers, the X hydration helpers, and the compose/publish flow
 * all reference ONE definition.
 */
export interface FetchedPost {
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
