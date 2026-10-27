/**
 * The CONTRIBUTOR dashboard (role shell `contributor`): their own posts by
 * state — drafts, waiting for review, published — and a "Write a new post"
 * button. Posts are listed through the same `/posts` API, which returns only
 * the caller's own posts for an own-scope user.
 */
import { A, } from '@solidjs/router';
import type { Post, } from '@sitesurge/types';
import { createResource, For, Show, type Component, } from 'solid-js';
import NotificationsBadgeLink from '../../components/admin/notifications/NotificationsBadgeLink';
import AdminTitle from '../../components/admin/common/AdminTitle';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './ContributorDashboard.scss';

type State = 'draft' | 'pending_review' | 'published';

const LABEL: Record<State, string> = { draft: 'Drafts', pending_review: 'Waiting for review', published: 'Published', };
const day = (iso?: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },) : '');

const ContributorDashboard: Component = () => {
    const auth = useAuth();
    const [posts,] = createResource(async () => {
        try {
            const res = await cms.posts.list({ status: 'all', limit: 100, sort: 'updated_desc', } as never,);
            return (res.data ?? []) as Post[];
        } catch {
            return [] as Post[];
        }
    },);
    const by = (s: State,) => (posts() ?? []).filter((p,) => (p.status as string) === s,);

    return (
        <div class="contributor-dashboard">
            <AdminTitle>Dashboard</AdminTitle>
            <div class="admin-header">
                <div class="admin-header__title-row">
                    <h1>Welcome, {auth.user?.displayName || 'contributor'}</h1>
                    <NotificationsBadgeLink />
                </div>
                <div class="admin-header__actions">
                    <A href="/admin/posts/new" class="ui-button ui-button--primary">Write a new post</A>
                </div>
            </div>
            <p class="form-help-muted">
                Write your posts here and press <strong>Submit for review</strong> when one is ready. Our team reviews it and publishes it —
                or returns it to you with a note.
            </p>
            <div class="contributor-dashboard__stats">
                <For each={['draft', 'pending_review', 'published',] as State[]}>
                    {(s,) => (
                        <A href={`/admin/posts?status=${s}`} class={`contributor-dashboard__stat contributor-dashboard__stat--${s}`}>
                            <span class="contributor-dashboard__count">{posts.loading ? '…' : by(s,).length}</span>
                            <span>{LABEL[s]}</span>
                        </A>
                    )}
                </For>
            </div>
            <section class="admin-section">
                <header class="admin-section__header"><h2>Your recent posts</h2></header>
                <Show when={(posts() ?? []).length} fallback={<p class="form-help-muted">You have not written a post yet.</p>}>
                    <ul class="contributor-dashboard__list">
                        <For each={(posts() ?? []).slice(0, 10,)}>
                            {(p,) => (
                                <li>
                                    <A href={`/admin/posts/${p.id}`}>{p.title || 'Untitled'}</A>
                                    <span class={`editor-pill editor-pill--${p.status}`}>{LABEL[p.status as State] ?? p.status}</span>
                                    <span class="form-help-muted">{day(p.updatedAt ? String(p.updatedAt,) : null,)}</span>
                                    <Show when={(p as { reviewNote?: string | null; }).reviewNote && p.status === 'draft'}>
                                        <span class="contributor-dashboard__note">Returned: {(p as { reviewNote?: string; }).reviewNote}</span>
                                    </Show>
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>
            </section>
        </div>
    );
};

export default ContributorDashboard;
