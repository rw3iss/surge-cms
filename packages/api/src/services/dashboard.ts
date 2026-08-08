/**
 * Dashboard service — aggregates the admin dashboard summary from
 * parallel count/stat queries across pages, posts, users, campaigns,
 * messages, donations, forms, and subscriptions.
 */
import type { DashboardRecentPost, } from '@sitesurge/types';
import { query, } from '../db';

// Key in site_settings holding the ISO timestamp at which an admin last
// dismissed the "pending donations" alert. The alert only counts pending
// donations created AFTER this — so a dismiss clears it for every admin, and a
// NEW pending donation re-surfaces it. Stored raw (no cache) — read once/render.
const PENDING_ACK_KEY = 'dashboard_pending_donations_ack';

async function getPendingDonationsAck(): Promise<string | null> {
    const r = await query(`SELECT value FROM site_settings WHERE key = $1`, [PENDING_ACK_KEY,],);
    // Stored as a JSON string; `value` is JSONB → a bare string.
    const v = r.rows[0]?.value;
    return typeof v === 'string' ? v : null;
}

/** Dismiss the pending-donations alert for all admins (records "now"). */
export async function dismissPendingDonations(): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value) VALUES ($1, to_jsonb(NOW()::text))
         ON CONFLICT (key) DO UPDATE SET value = to_jsonb(NOW()::text), updated_at = NOW()`,
        [PENDING_ACK_KEY,],
    );
}

export interface DashboardSummary {
    pages: { total: number; };
    posts: { total: number; };
    users: { total: number; activeSubscriptions: number; };
    campaigns: { active: number; totalRaisedCents: number; totalDonors: number; };
    messages: { unread: number; };
    donations: { last30Days: { count: number; totalCents: number; }; };
    forms: { submissionsLast30Days: number; };
    recentPosts: DashboardRecentPost[];
    quickActions: Array<{ label: string; href: string; urgent: boolean; dismissKey?: string; }>;
}

export async function summary(): Promise<DashboardSummary> {
    // Pending-donations alert is scoped to donations created AFTER the last
    // dismiss, so an X on the dashboard clears it for everyone until a new
    // pending donation arrives.
    const pendingAck = await getPendingDonationsAck();
    const [
        pageCount,
        postCount,
        campaignStats,
        userCount,
        unreadMessages,
        recentDonations,
        formSubmissions,
        recentPosts,
        activeSubscriptions,
        pendingDonations,
    ] = await Promise.all([
        query('SELECT COUNT(*) FROM pages',),
        query('SELECT COUNT(*) FROM posts',),
        query(`SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_campaigns,
        COALESCE(SUM(current_amount_cents), 0) as total_raised_cents,
        COALESCE(SUM(donor_count), 0) as total_donors
        FROM campaigns`,),
        query('SELECT COUNT(*) FROM users WHERE is_active = true',),
        query(`SELECT COUNT(*) FROM contact_messages WHERE status = 'unread'`,),
        query(`SELECT COUNT(*) as count, COALESCE(SUM(amount_cents), 0) as total
        FROM donations WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '30 days'`,),
        query(`SELECT COUNT(*) FROM form_submissions
        WHERE submitted_at >= NOW() - INTERVAL '30 days'`,),
        query(`SELECT id, title, slug, status, created_at FROM posts
        ORDER BY created_at DESC LIMIT 5`,),
        query(`SELECT COUNT(*) FROM subscriptions WHERE status = 'active'`,),
        pendingAck
            ? query(`SELECT COUNT(*) FROM donations WHERE status = 'pending' AND created_at > $1`, [pendingAck,],)
            : query(`SELECT COUNT(*) FROM donations WHERE status = 'pending'`,),
    ],);

    const unreadCount = parseInt(unreadMessages.rows[0].count, 10,);
    const pendingCount = parseInt(pendingDonations.rows[0].count, 10,);

    const quickActions: Array<{ label: string; href: string; urgent: boolean; dismissKey?: string; }> = [];

    if (unreadCount > 0) {
        quickActions.push({
            label: `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`,
            href: '/admin/messages',
            urgent: unreadCount > 0,
        },);
    }

    if (pendingCount > 0) {
        quickActions.push({
            label: `${pendingCount} pending donation${pendingCount !== 1 ? 's' : ''}`,
            href: '/admin/campaigns',
            urgent: pendingCount > 0,
            dismissKey: 'pending-donations',
        },);
    }

    return {
        pages: {
            total: parseInt(pageCount.rows[0].count, 10,),
        },
        posts: {
            total: parseInt(postCount.rows[0].count, 10,),
        },
        users: {
            total: parseInt(userCount.rows[0].count, 10,),
            activeSubscriptions: parseInt(activeSubscriptions.rows[0].count, 10,),
        },
        campaigns: {
            active: parseInt(campaignStats.rows[0].active_campaigns, 10,),
            totalRaisedCents: parseInt(campaignStats.rows[0].total_raised_cents, 10,),
            totalDonors: parseInt(campaignStats.rows[0].total_donors, 10,),
        },
        messages: {
            unread: unreadCount,
        },
        donations: {
            last30Days: {
                count: parseInt(recentDonations.rows[0].count, 10,),
                totalCents: parseInt(recentDonations.rows[0].total, 10,),
            },
        },
        forms: {
            submissionsLast30Days: parseInt(formSubmissions.rows[0].count, 10,),
        },
        recentPosts: recentPosts.rows as DashboardRecentPost[],
        quickActions,
    };
}
