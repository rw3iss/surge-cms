/**
 * Wire DTOs for the /dashboard module. The handler returns a fully
 * aggregated stats object; this mirrors the API package's
 * `DashboardSummary` service type as the wire shape.
 */

/** A recent-post row on the dashboard (raw DB projection). */
export interface DashboardRecentPost {
    id: string;
    title: string;
    slug: string;
    status: string;
    created_at: string;
}

/** A dashboard quick-action chip. */
export interface DashboardQuickAction {
    label: string;
    href: string;
    urgent: boolean;
}

/** GET /api/v1/dashboard/summary — admin stats + recent activity. */
export interface DashboardSummaryResponse {
    pages: { total: number; };
    posts: { total: number; };
    users: { total: number; activeSubscriptions: number; };
    campaigns: { active: number; totalRaisedCents: number; totalDonors: number; };
    messages: { unread: number; };
    donations: { last30Days: { count: number; totalCents: number; }; };
    forms: { submissionsLast30Days: number; };
    recentPosts: DashboardRecentPost[];
    quickActions: DashboardQuickAction[];
}
