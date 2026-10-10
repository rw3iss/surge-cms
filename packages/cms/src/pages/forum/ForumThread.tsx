/**
 * /forum/:category/:thread — the thread: title, opening post, replies (oldest
 * first, paged) and the reply box. Replies are discussion comments, rendered
 * with the same components as post/event comments. Moderators get pin / lock
 * / hide controls; the author can rename the thread.
 */
import type { Comment, CommentTargetRef, DiscussionsSettings, ForumThreadDetail, } from '@sitesurge/types';
import { formatRelativeTime, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, on, Show, } from 'solid-js';
import UpgradeTout from '../../components/content/UpgradeTout';
import SeoHead from '../../components/common/seo/SeoHead';
import CommentComposer, { errorText, } from '../../components/discussions/CommentComposer';
import CommentItem from '../../components/discussions/CommentItem';
import CommentThread from '../../components/discussions/CommentThread';
import '../../components/discussions/discussions.scss';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import NotFoundPage from '../NotFound';
import './forum.scss';

type Loaded = { ok: true; t: ForumThreadDetail; } | { ok: false; status: number; message: string; };

const ForumThread: Component = () => {
    const params = useParams<{ category: string; thread: string; }>();
    const [search, setSearch,] = useSearchParams<{ page?: string; }>();
    const auth = useAuth();
    const navigate = useNavigate();
    const page = () => Math.max(1, Number(search.page ?? 1,) || 1,);

    const [settings,] = createResource(() => cms.discussions.settings().catch(() => null as DiscussionsSettings | null),);
    const [forumSettings,] = createResource(() => cms.forum.settings().catch(() => null),);
    const perPage = () => forumSettings()?.postsPerPage ?? 20;

    const [thread, { refetch: refetchThread, },] = createResource(
        () => ({ c: params.category, t: params.thread, who: auth.user?.id ?? 'anon', }),
        async (k,): Promise<Loaded> => {
            try {
                return { ok: true, t: await cms.forum.threads.get(k.c, k.t,), };
            } catch (e) {
                return { ok: false, status: (e as { status?: number; }).status ?? 500, message: errorText(e,), };
            }
        },
    );
    const t = () => {
        const r = thread();
        return r && r.ok ? r.t : null;
    };
    const target = (): CommentTargetRef => `forum_thread:${t()!.id}`;

    const [replies, setReplies,] = createSignal<Comment[]>([],);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const loadReplies = async () => {
        const th = t();
        if (!th) return;
        try {
            const r = await cms.discussions.list(`forum_thread:${th.id}`, { sort: 'oldest', page: page(), limit: perPage(), },);
            setReplies(r.data,);
            setTotalPages(r.meta?.totalPages ?? 1,);
        } catch {
            setReplies([],);
        }
    };
    createEffect(on(() => [t()?.id, page(), perPage(),] as const, () => void loadReplies(),),);

    const refreshAll = () => {
        void refetchThread();
        void loadReplies();
    };

    // ─── Moderation + rename ───
    const [busy, setBusy,] = createSignal(false,);
    const [modError, setModError,] = createSignal('',);
    const act = async (action: 'pin' | 'unpin' | 'lock' | 'unlock' | 'hide' | 'delete',) => {
        setBusy(true,);
        setModError('',);
        try {
            await cms.forum.threads.act(t()!.id, action,);
            if (action === 'hide' || action === 'delete') navigate(`/forum/${params.category}`,);
            else refetchThread();
        } catch (e) {
            setModError(errorText(e,),);
        } finally {
            setBusy(false,);
        }
    };
    const [renaming, setRenaming,] = createSignal(false,);
    const [newTitle, setNewTitle,] = createSignal('',);
    const rename = async () => {
        setBusy(true,);
        setModError('',);
        try {
            await cms.forum.threads.update(t()!.id, { title: newTitle().trim(), },);
            setRenaming(false,);
            refetchThread();
        } catch (e) {
            setModError(errorText(e,),);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <div class="forum page-wrapper">
            <Show when={thread()} fallback={<p>Loading…</p>}>
                {(r,) => (
                    <Show
                        when={t()}
                        fallback={
                            <Show
                                when={!r().ok && (r() as Extract<Loaded, { ok: false; }>).status === 403}
                                fallback={<NotFoundPage title="Thread not found" message="This thread does not exist, or it was removed." link={{ href: `/forum/${params.category}`, label: 'Back to the category', }} />}
                            >
                                <div class="forum__notice">
                                    <UpgradeTout title="Subscriber forum" message={(r() as Extract<Loaded, { ok: false; }>).message} />
                                </div>
                            </Show>
                        }
                    >
                        {(th,) => (
                            <>
                                <Title>{th().title} — Forum</Title>
                                <SeoHead title={th().title} description={th().excerpt || undefined} />
                                <nav class="forum__crumbs" aria-label="Breadcrumb">
                                    <A href="/forum">Forum</A><span>›</span>
                                    <A href={`/forum/${th().category.slug}`}>{th().category.name}</A>
                                </nav>

                                <div class="forum__thread-head">
                                    <Show
                                        when={renaming()}
                                        fallback={
                                            <h1>
                                                {th().title}
                                                <span class="forum__badges">
                                                    <Show when={th().pinned}><span title="Pinned">📌</span></Show>
                                                    <Show when={th().locked}><span title="Locked">🔒</span></Show>
                                                    <Show when={th().status === 'pending'}><span class="forum__badge">Awaiting approval</span></Show>
                                                    <Show when={th().status === 'hidden'}><span class="forum__badge">Hidden</span></Show>
                                                </span>
                                            </h1>
                                        }
                                    >
                                        <form class="forum__new" onSubmit={(e,) => { e.preventDefault(); void rename(); }}>
                                            <input type="text" maxLength={200} value={newTitle()} onInput={(e,) => setNewTitle(e.currentTarget.value,)} />
                                            <div class="forum__new-actions">
                                                <button type="button" class="btn btn--outline" onClick={() => setRenaming(false,)}>Cancel</button>
                                                <button type="submit" class="btn btn--primary" disabled={busy() || newTitle().trim().length < 3}>Save title</button>
                                            </div>
                                        </form>
                                    </Show>
                                    <div class="forum__mod">
                                        <Show when={th().canEdit && !renaming()}>
                                            <button type="button" class="btn btn--outline" onClick={() => { setNewTitle(th().title,); setRenaming(true,); }}>Rename</button>
                                        </Show>
                                        <Show when={th().canModerate}>
                                            <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => act(th().pinned ? 'unpin' : 'pin',)}>{th().pinned ? 'Unpin' : 'Pin'}</button>
                                            <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => act(th().locked ? 'unlock' : 'lock',)}>{th().locked ? 'Unlock' : 'Lock'}</button>
                                            <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => act('hide',)}>Hide</button>
                                        </Show>
                                    </div>
                                </div>
                                <Show when={modError()}><p class="forum__error">{modError()}</p></Show>
                                <p class="forum__byline">
                                    {th().replyCount} {th().replyCount === 1 ? 'reply' : 'replies'} · {th().viewCount} views · started {formatRelativeTime(th().createdAt,)}
                                </p>

                                <Show when={th().opening}>
                                    {(op,) => (
                                        <div class="forum__opening">
                                            <CommentItem
                                                comment={op()}
                                                target={target()}
                                                settings={settings() ?? null}
                                                allowReply={false}
                                                onChanged={refreshAll}
                                            />
                                        </div>
                                    )}
                                </Show>

                                <h2 class="forum__replies-head">Replies</h2>
                                <Show when={replies().length} fallback={<p class="forum__byline">No replies yet.</p>}>
                                    <CommentThread
                                        comments={replies()}
                                        target={target()}
                                        settings={settings() ?? null}
                                        allowReply={th().canReply}
                                        onChanged={refreshAll}
                                    />
                                </Show>

                                <Show when={totalPages() > 1}>
                                    <div class="forum__pager">
                                        <button type="button" class="btn btn--outline" disabled={page() <= 1} onClick={() => setSearch({ page: String(page() - 1,), },)}>← Earlier</button>
                                        <span>Page {page()} of {totalPages()}</span>
                                        <button type="button" class="btn btn--outline" disabled={page() >= totalPages()} onClick={() => setSearch({ page: String(page() + 1,), },)}>Later →</button>
                                    </div>
                                </Show>

                                <div class="forum__reply-box">
                                    <Show
                                        // Signed out: the composer itself offers "Log in to reply".
                                        when={th().canReply || !auth.user}
                                        fallback={<div class="forum__notice"><p>{th().replyBlockedReason}</p></div>}
                                    >
                                        <CommentComposer
                                            target={target()}
                                            placeholder="Write a reply (Markdown supported)…"
                                            submitLabel="Post reply"
                                            maxLength={settings()?.maxLength}
                                            onPosted={() => {
                                                // Jump to the last page, where the new reply lands.
                                                refreshAll();
                                                if (page() < totalPages()) setSearch({ page: String(totalPages(),), },);
                                            }}
                                            onLoggedIn={refreshAll}
                                        />
                                    </Show>
                                </div>
                            </>
                        )}
                    </Show>
                )}
            </Show>
        </div>
    );
};

export default ForumThread;
