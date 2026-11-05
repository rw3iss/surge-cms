/**
 * The ONE contract every social analytics collector implements.
 *
 * A collector only FETCHES: it returns what the platform said, in our shape,
 * and the runner (runner.ts) writes it — so storage, run bookkeeping and the
 * "daily for 90 days, weekly after" post cadence live in one place.
 * Register with `registerCollector` (registry.ts); add the file's import to
 * collectors/index.ts.
 */
import type { SocialAnalyticsPlatform, SocialCollectorStatus, } from '@sitesurge/types';

/** A captured post the runner wants numbers for (from social_posts). */
export interface KnownPost {
    id: string;
    externalId: string;
    publishedAt: string | null;
    kind: string | null;
}

export interface CollectContext {
    /** Today (UTC, YYYY-MM-DD) — the snapshot date. */
    today: string;
    /** Posts due a metrics snapshot today (published ≤ 90 days ago, older ones weekly). */
    posts: KnownPost[];
    /** The connection's credentials + settings (may be empty when not connected). */
    credentials: Record<string, unknown>;
    settings: Record<string, unknown>;
    /** Report a non-fatal problem (one metric failed, a scope is missing…). */
    warn(message: string,): void;
}

export interface AccountSnapshot {
    followers?: number | null;
    following?: number | null;
    postsCount?: number | null;
    totalViews?: number | null;
    totalLikes?: number | null;
    raw?: Record<string, unknown>;
}

/** One value of a platform daily series. dimension '' = the account total. */
export interface DailyPoint {
    date: string;
    metric: string;
    value: number;
    dimension?: string;
}

/** A post's cumulative numbers as of `today`; keyed by the platform's id. */
export interface PostMetric {
    externalId: string;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    watchTimeS?: number | null;
    avgWatchS?: number | null;
    completionRate?: number | null;
    reach?: number | null;
    impressions?: number | null;
    clicks?: number | null;
    raw?: Record<string, unknown>;
}

export interface CollectResult {
    account?: AccountSnapshot | null;
    daily?: DailyPoint[];
    posts?: PostMetric[];
}

export interface SocialAnalyticsCollector {
    platform: SocialAnalyticsPlatform;
    label: string;
    /** Which `social_connections.provider` row holds its credentials. */
    connection: string;
    /** What it can collect with the current credentials. Must not throw. */
    status(credentials: Record<string, unknown>, connected: boolean,): Promise<SocialCollectorStatus> | SocialCollectorStatus;
    collect(ctx: CollectContext,): Promise<CollectResult>;
    /** Extra scheduled jobs (token refresh, a Stories sweep…); registered on the primary. */
    crons?: Array<{ name: string; schedule: string; description: string; handler: () => Promise<void>; }>;
}
