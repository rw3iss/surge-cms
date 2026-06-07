import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';
import { isFeatureEnabled, loadSiteSettings, siteSettings, } from '../../stores/siteSettings';

/**
 * Site features rendered in the dashboard panel. Order matches the
 * Settings → Features section so the experience reads consistently.
 */
const DASHBOARD_FEATURES: Array<{ key: 'posts' | 'campaigns' | 'forms' | 'messages' | 'users' | 'mailing_lists'; label: string; }> = [
    { key: 'posts', label: 'Posts', },
    { key: 'campaigns', label: 'Campaigns', },
    { key: 'forms', label: 'Forms', },
    { key: 'messages', label: 'Messages', },
    { key: 'users', label: 'Users', },
    { key: 'mailing_lists', label: 'Mailing Lists', },
];

const AdminDashboard: Component = () => {
    const [stats,] = createResource(async () => {
        const response = await api.get('/dashboard/summary',);
        return response.success ? (response as any).data : null;
    },);

    // Make the feature flags reactive on the dashboard the same way
    // they are in the sidebar — load once, then read through
    // `isFeatureEnabled` (which itself tracks `siteSettings()`).
    void loadSiteSettings();
    // Touch the signal so the dashboard re-renders when settings load
    // and when the admin saves changes via Settings → Features.
    const _ = () => siteSettings();

    const formatCurrency = (cents: number,) =>
        `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, },)}`;

    return (
        <div class="admin-dashboard">
            <Title>Dashboard - Admin - RW</Title>

            <div class="admin-header">
                <h1>Dashboard</h1>
                <p class="admin-header__subtitle">Welcome back. Here's what's happening with your site.</p>
            </div>

            <Show when={stats()} fallback={<div class="dashboard-loading">Loading dashboard...</div>}>
                {(data,) => (
                    <>
                        {/* Urgent Actions Banner */}
                        <Show when={data().quickActions?.some((a: any,) => a.urgent)}>
                            <div class="dashboard-alerts">
                                <For each={data().quickActions?.filter((a: any,) => a.urgent)}>
                                    {(action: any,) => (
                                        <A href={action.href} class="dashboard-alert dashboard-alert--warning">
                                            <span class="dashboard-alert__icon">!</span>
                                            <span>{action.label}</span>
                                            <span class="dashboard-alert__arrow">&rarr;</span>
                                        </A>
                                    )}
                                </For>
                            </div>
                        </Show>

                        {/* Stats Grid — each card is gated on its
                            corresponding feature flag so disabled
                            modules don't show stats the operator
                            can't act on. Pages stays unconditional
                            (it's the core CMS surface, no flag). */}
                        <div class="dashboard-stats">
                            <A href="/admin/pages" class="stat-card">
                                <div class="stat-card__icon stat-card__icon--blue">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                    </svg>
                                </div>
                                <div class="stat-card__content">
                                    <span class="stat-card__value">{data().pages.total}</span>
                                    <span class="stat-card__label">Pages</span>
                                </div>
                            </A>

                            <Show when={isFeatureEnabled('posts',)}>
                                <A href="/admin/posts" class="stat-card">
                                    <div class="stat-card__icon stat-card__icon--green">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                    </div>
                                    <div class="stat-card__content">
                                        <span class="stat-card__value">{data().posts.total}</span>
                                        <span class="stat-card__label">Posts</span>
                                    </div>
                                </A>
                            </Show>

                            <Show when={isFeatureEnabled('users',)}>
                                <A href="/admin/users" class="stat-card">
                                    <div class="stat-card__icon stat-card__icon--purple">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                                            <circle cx="9" cy="7" r="4" />
                                            <path d="M23 21v-2a4 4 0 00-3-3.87" />
                                            <path d="M16 3.13a4 4 0 010 7.75" />
                                        </svg>
                                    </div>
                                    <div class="stat-card__content">
                                        <span class="stat-card__value">{data().users.total}</span>
                                        <span class="stat-card__label">Users</span>
                                    </div>
                                </A>
                            </Show>

                            <Show when={isFeatureEnabled('messages',)}>
                                <A href="/admin/messages" class="stat-card">
                                    <div class="stat-card__icon stat-card__icon--orange">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                                        </svg>
                                    </div>
                                    <div class="stat-card__content">
                                        <span class="stat-card__value">{data().messages.unread}</span>
                                        <span class="stat-card__label">Unread Messages</span>
                                    </div>
                                </A>
                            </Show>

                            <Show when={isFeatureEnabled('campaigns',)}>
                                <A href="/admin/campaigns" class="stat-card stat-card--wide">
                                    <div class="stat-card__icon stat-card__icon--red">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="12" y1="1" x2="12" y2="23" />
                                            <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                                        </svg>
                                    </div>
                                    <div class="stat-card__content">
                                        <span class="stat-card__value">
                                            {formatCurrency(data().campaigns.totalRaisedCents,)}
                                        </span>
                                        <span class="stat-card__label">
                                            Total Raised ({data().campaigns.active} active campaigns,{' '}
                                            {data().campaigns.totalDonors} donors)
                                        </span>
                                    </div>
                                </A>
                            </Show>

                            <Show when={isFeatureEnabled('users',)}>
                                <div class="stat-card">
                                    <div class="stat-card__icon stat-card__icon--teal">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                                            <line x1="1" y1="10" x2="23" y2="10" />
                                        </svg>
                                    </div>
                                    <div class="stat-card__content">
                                        <span class="stat-card__value">{data().users.activeSubscriptions}</span>
                                        <span class="stat-card__label">Active Subscriptions</span>
                                    </div>
                                </div>
                            </Show>
                        </div>

                        {/* Two column layout: Recent activity + 30-day summary.
                            Each panel and each row inside the 30-day
                            summary is feature-gated so disabled
                            modules don't surface stale data. */}
                        <div class="dashboard-panels">
                            <Show when={isFeatureEnabled('posts',)}>
                                <div class="dashboard-panel">
                                    <div class="dashboard-panel__header">
                                        <h2>Recent Posts</h2>
                                        <A href="/admin/posts" class="dashboard-panel__link">View All &rarr;</A>
                                    </div>
                                    <div class="dashboard-panel__body">
                                        <Show
                                            when={data().recentPosts?.length}
                                            fallback={<p class="text-muted">No posts yet.</p>}
                                        >
                                            <For each={data().recentPosts}>
                                                {(post: any,) => (
                                                    <A href={`/admin/posts/${post.id}`} class="dashboard-activity-item">
                                                        <div class="dashboard-activity-item__content">
                                                            <span class="dashboard-activity-item__title">{post.title}</span>
                                                            <span class="dashboard-activity-item__meta">
                                                                <span
                                                                    class={`badge badge--small ${
                                                                        post.status === 'published' ?
                                                                            'badge--success' :
                                                                            'badge--warning'
                                                                    }`}
                                                                >
                                                                    {post.status}
                                                                </span>
                                                                <span>
                                                                    {new Date(post.createdAt || post.created_at,)
                                                                        .toLocaleDateString()}
                                                                </span>
                                                            </span>
                                                        </div>
                                                    </A>
                                                )}
                                            </For>
                                        </Show>
                                    </div>
                                </div>
                            </Show>

                            <div class="dashboard-panel">
                                <div class="dashboard-panel__header">
                                    <h2>Last 30 Days</h2>
                                </div>
                                <div class="dashboard-panel__body">
                                    {(() => {
                                        // Compute per-row visibility once so the empty-state
                                        // fallback can also tell whether anything will render.
                                        const showDonations = () => isFeatureEnabled('campaigns',);
                                        const showForms = () => isFeatureEnabled('forms',);
                                        const hasAny = () => showDonations() || showForms();
                                        return (
                                            <Show
                                                when={hasAny()}
                                                fallback={<p class="text-muted">No recent data.</p>}
                                            >
                                                <div class="dashboard-summary-list">
                                                    <Show when={showDonations()}>
                                                        <div class="dashboard-summary-item">
                                                            <span class="dashboard-summary-item__label">Donations received</span>
                                                            <span class="dashboard-summary-item__value">
                                                                {data().donations.last30Days.count}
                                                            </span>
                                                        </div>
                                                        <div class="dashboard-summary-item">
                                                            <span class="dashboard-summary-item__label">Donation revenue</span>
                                                            <span class="dashboard-summary-item__value">
                                                                {formatCurrency(data().donations.last30Days.totalCents,)}
                                                            </span>
                                                        </div>
                                                    </Show>
                                                    <Show when={showForms()}>
                                                        <div class="dashboard-summary-item">
                                                            <span class="dashboard-summary-item__label">Form submissions</span>
                                                            <span class="dashboard-summary-item__value">
                                                                {data().forms.submissionsLast30Days}
                                                            </span>
                                                        </div>
                                                    </Show>
                                                </div>
                                            </Show>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <div class="dashboard-quick-actions">
                            <h2>Quick Actions</h2>
                            <div class="dashboard-quick-actions__grid">
                                <A href="/admin/posts/new" class="quick-action-btn">
                                    <span class="quick-action-btn__icon">+</span>
                                    New Post
                                </A>
                                <A href="/admin/pages/new" class="quick-action-btn">
                                    <span class="quick-action-btn__icon">+</span>
                                    New Page
                                </A>
                                <A href="/admin/campaigns/new" class="quick-action-btn">
                                    <span class="quick-action-btn__icon">+</span>
                                    New Campaign
                                </A>
                                <A href="/admin/forms/new" class="quick-action-btn">
                                    <span class="quick-action-btn__icon">+</span>
                                    New Form
                                </A>
                            </div>
                        </div>

                        {/* Site Features overview — at-a-glance status of
                            each module, with a deep link into the Features
                            section of Settings → General. Compact vertical
                            list: label left, status pill right. Container
                            is width-constrained so the section doesn't
                            sprawl on wide displays. */}
                        <div class="dashboard-features">
                            <div class="dashboard-features__header">
                                <h2>Site Features</h2>
                                <A
                                    href="/admin/settings?tab=general#features"
                                    class="dashboard-features__manage"
                                >
                                    Manage Features &rarr;
                                </A>
                            </div>
                            <ul class="dashboard-features__list">
                                <For each={DASHBOARD_FEATURES}>
                                    {(f,) => (
                                        <li class="dashboard-feature-row">
                                            <span class="dashboard-feature-row__name">{f.label}</span>
                                            <span
                                                class={`dashboard-feature-row__badge dashboard-feature-row__badge--${
                                                    isFeatureEnabled(f.key,) ? 'enabled' : 'disabled'
                                                }`}
                                            >
                                                {isFeatureEnabled(f.key,) ? 'Enabled' : 'Disabled'}
                                            </span>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </div>
                    </>
                )}
            </Show>
        </div>
    );
};

export default AdminDashboard;
