/**
 * Dashboard service — aggregates the admin dashboard summary from
 * parallel count/stat queries across pages, posts, users, campaigns,
 * messages, donations, forms, and subscriptions.
 */
import type { DashboardRecentPost, } from '@rw/cms-shared';
import { query, } from '../db';

export interface DashboardSummary {
    pages: { total: number; };
    posts: { total: number; };
    users: { total: number; activeSubscriptions: number; };
    campaigns: { active: number; totalRaisedCents: number; totalDonors: number; };
    messages: { unread: number; };
    donations: { last30Days: { count: number; totalCents: number; }; };
    forms: { submissionsLast30Days: number; };
    recentPosts: DashboardRecentPost[];
    quickActions: Array<{ label: string; href: string; urgent: boolean; }>;
}

export async function summary(): Promise<DashboardSummary> {
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
        query(`SELECT COUNT(*) FROM donations WHERE status = 'pending'`,),
    ],);

    const unreadCount = parseInt(unreadMessages.rows[0].count, 10,);
    const pendingCount = parseInt(pendingDonations.rows[0].count, 10,);

    const quickActions: Array<{ label: string; href: string; urgent: boolean; }> = [];

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
