import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { SocialPost, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';

/** Platforms the manager can list. Capture (add-by-URL) is X-only today. */
const PLATFORMS = ['twitter', 'youtube', 'instagram', 'facebook', 'tiktok', 'patreon',];

const SocialPostsPanel: Component = () => {
    const [platform, setPlatform,] = createSignal('twitter',);
    const [refreshKey, setRefreshKey,] = createSignal(0,);
    const [url, setUrl,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    const [msg, setMsg,] = createSignal<{ text: string; error: boolean; } | null>(null,);

    const [posts, { refetch, },] = createResource(
        () => [platform(), refreshKey(),] as const,
        async ([p,],) => {
            try {
                const res = await cms.social.platformPosts(p, { includeHidden: true, limit: 50, },);
                return res.data as SocialPost[];
            } catch {
                return [] as SocialPost[];
            }
        },
    );

    const flash = (text: string, error = false,): void => {
        setMsg({ text, error, },);
        setTimeout(() => setMsg(null,), 4000,);
    };

    const addByUrl = async (e: Event,): Promise<void> => {
        e.preventDefault();
        const value = url().trim();
        if (!value) return;
        setBusy(true,);
        try {
            await cms.social.addManualPost({ url: value, },);
            setUrl('',);
            flash('Post added.',);
            setPlatform('twitter',);
            void refetch();
        } catch (err) {
            flash(err instanceof Error ? err.message : 'Could not add that post.', true,);
        } finally {
            setBusy(false,);
        }
    };

    const toggleHidden = async (post: SocialPost,): Promise<void> => {
        try {
            await cms.social.patchPost(post.id, { isHidden: !post.isHidden, },);
            void refetch();
        } catch {
            flash('Could not update the post.', true,);
        }
    };

    const remove = async (post: SocialPost,): Promise<void> => {
        if (!confirm('Delete this post from the feed? This cannot be undone.',)) return;
        try {
            await cms.social.deletePost(post.id,);
            flash('Post deleted.',);
            void refetch();
        } catch {
            flash('Could not delete the post.', true,);
        }
    };

    // Swap this post's sort order with its neighbor (up = earlier).
    const move = async (index: number, dir: -1 | 1,): Promise<void> => {
        const list = posts() ?? [];
        const other = index + dir;
        if (other < 0 || other >= list.length) return;
        const a = list[index];
        const b = list[other];
        try {
            await Promise.all([
                cms.social.patchPost(a.id, { sortOrder: b.sortOrder ?? other, },),
                cms.social.patchPost(b.id, { sortOrder: a.sortOrder ?? index, },),
            ],);
            void refetch();
        } catch {
            flash('Could not reorder.', true,);
        }
    };

    return (
        <section class="social-posts">
            <div class="social-posts__toolbar">
                <label class="social-posts__filter">
                    <span>Platform</span>
                    <select value={platform()} onChange={(e,) => setPlatform(e.currentTarget.value,)}>
                        <For each={PLATFORMS}>{(p,) => <option value={p}>{p}</option>}</For>
                    </select>
                </label>

                <form class="social-posts__add" onSubmit={addByUrl}>
                    <input
                        type="url"
                        placeholder="Paste an X/Twitter post URL, e.g. https://x.com/user/status/123"
                        value={url()}
                        onInput={(e,) => setUrl(e.currentTarget.value,)}
                    />
                    <button type="submit" class="btn btn--primary btn--small" disabled={busy()}>
                        {busy() ? 'Adding…' : 'Add post'}
                    </button>
                </form>
            </div>

            <p class="form-help">
                Paste a post's URL to add it to the feed. It's hydrated + cached, then rendered as a
                native card (no third-party scripts). Compose new posts on the Compose tab.
            </p>

            <Show when={msg()}>
                {(m,) => <div class={`social-posts__msg ${m().error ? 'is-error' : 'is-ok'}`}>{m().text}</div>}
            </Show>

            <Show
                when={(posts() ?? []).length}
                fallback={<div class="empty-state">No posts for this platform yet.</div>}
            >
                <ul class="social-posts__list">
                    <For each={posts()}>
                        {(post, i,) => (
                            <li class={`social-posts__row ${post.isHidden ? 'is-hidden' : ''}`}>
                                <div class="social-posts__thumb">
                                    <Show when={post.thumbnailUrl} fallback={<span class="social-posts__thumb-ph" />}>
                                        <img src={post.thumbnailUrl!} alt="" />
                                    </Show>
                                </div>
                                <div class="social-posts__meta">
                                    <div class="social-posts__author">
                                        {post.authorName || post.externalId}
                                        <span class={`social-posts__badge social-posts__badge--${post.source ?? 'sync'}`}>
                                            {post.source ?? 'sync'}
                                        </span>
                                        <Show when={post.isHidden}>
                                            <span class="social-posts__badge social-posts__badge--hidden">hidden</span>
                                        </Show>
                                    </div>
                                    <div class="social-posts__excerpt">{post.content || '(no text)'}</div>
                                </div>
                                <div class="social-posts__actions">
                                    <button class="btn btn--tiny" title="Move up" onClick={() => move(i(), -1,)}>↑</button>
                                    <button class="btn btn--tiny" title="Move down" onClick={() => move(i(), 1,)}>↓</button>
                                    <button class="btn btn--tiny" onClick={() => toggleHidden(post,)}>
                                        {post.isHidden ? 'Show' : 'Hide'}
                                    </button>
                                    <button class="btn btn--tiny btn--danger" onClick={() => remove(post,)}>Delete</button>
                                </div>
                            </li>
                        )}
                    </For>
                </ul>
            </Show>
        </section>
    );
};

export default SocialPostsPanel;
