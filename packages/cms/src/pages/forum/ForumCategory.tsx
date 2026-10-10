/**
 * /forum/:category — the category's threads (pinned first, then by last
 * activity) and the "New thread" form for members who may post here.
 */
import type { ForumCategoryThreadsResponse, ForumThread, PageMeta, } from '@sitesurge/types';
import { formatRelativeTime, renderMarkdown, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import LoginModal from '../../components/auth/LoginModal';
import UpgradeTout from '../../components/content/UpgradeTout';
import SeoHead from '../../components/common/seo/SeoHead';
import AuthorCard from '../../components/discussions/AuthorCard';
import { errorText, } from '../../components/discussions/CommentComposer';
import '../../components/discussions/discussions.scss';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import NotFoundPage from '../NotFound';
import './forum.scss';

type Loaded = { ok: true; data: ForumCategoryThreadsResponse; meta: PageMeta; } | { ok: false; status: number; message: string; };

const ForumCategory: Component = () => {
    const params = useParams<{ category: string; }>();
    const [search, setSearch,] = useSearchParams<{ page?: string; }>();
    const auth = useAuth();
    const navigate = useNavigate();
    const page = () => Math.max(1, Number(search.page ?? 1,) || 1,);
    const [login, setLogin,] = createSignal(false,);

    const [res, { refetch, },] = createResource(
        () => ({ slug: params.category, page: page(), who: auth.user?.id ?? 'anon', }),
        async (k,): Promise<Loaded> => {
            try {
                const r = await cms.forum.categories.threads(k.slug, { page: k.page, },);
                return { ok: true, data: r.data, meta: r.meta, };
            } catch (e) {
                return { ok: false, status: (e as { status?: number; }).status ?? 500, message: errorText(e,), };
            }
        },
    );

    // ─── New thread ───
    const [composing, setComposing,] = createSignal(false,);
    const [title, setTitle,] = createSignal('',);
    const [body, setBody,] = createSignal('',);
    const [preview, setPreview,] = createSignal(false,);
    const [posting, setPosting,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const submit = async (categoryId: string,) => {
        setPosting(true,);
        setError('',);
        try {
            const t = await cms.forum.threads.create({ categoryId, title: title().trim(), body: body().trim(), },);
            setTitle('',);
            setBody('',);
            setComposing(false,);
            navigate(t.url,);
        } catch (e) {
            setError(errorText(e, 'Could not start the thread.',),);
        } finally {
            setPosting(false,);
        }
    };

    const ThreadRow: Component<{ t: ForumThread; }> = (p,) => (
        <div class={`forum__thread${p.t.pinned ? ' forum__thread--pinned' : ''}`}>
            <div>
                <A href={p.t.url} class="forum__thread-title">{p.t.title}</A>
                <span class="forum__badges">
                    <Show when={p.t.pinned}><span title="Pinned">📌</span></Show>
                    <Show when={p.t.locked}><span title="Locked">🔒</span></Show>
                    <Show when={p.t.status === 'pending'}><span class="forum__badge">Awaiting approval</span></Show>
                </span>
                <div class="forum__byline">
                    <AuthorCard author={p.t.author} compact /> · {formatRelativeTime(p.t.createdAt,)}
                </div>
            </div>
            <div class="forum__counts">
                <span><strong>{p.t.replyCount}</strong> replies</span>
                <span><strong>{p.t.viewCount}</strong> views</span>
            </div>
            <div class="forum__latest">
                <Show when={p.t.lastReplyAt} fallback={<span>No replies yet</span>}>
                    <span>Last reply {formatRelativeTime(p.t.lastReplyAt!,)}</span>
                    <Show when={p.t.lastReplyBy}>{(b,) => <span>by {b().name}</span>}</Show>
                </Show>
            </div>
        </div>
    );

    return (
        <div class="forum page-wrapper">
            <Show when={res()} fallback={<p>Loading…</p>}>
                {(r,) => (
                    <Show
                        when={r().ok ? (r() as Extract<Loaded, { ok: true; }>) : null}
                        fallback={
                            <Show
                                when={(r() as Extract<Loaded, { ok: false; }>).status === 403}
                                fallback={<NotFoundPage title="Category not found" link={{ href: '/forum', label: 'All categories', }} />}
                            >
                                <div class="forum__notice">
                                    <Show
                                        when={auth.user}
                                        fallback={
                                            <p>
                                                <a href="#" onClick={(e,) => { e.preventDefault(); setLogin(true,); }}>Sign in</a> to read this part of the forum.
                                            </p>
                                        }
                                    >
                                        <UpgradeTout title="Subscriber forum" message={(r() as Extract<Loaded, { ok: false; }>).message} />
                                    </Show>
                                </div>
                            </Show>
                        }
                    >
                        {(ok,) => {
                            const cat = () => ok().data.category;
                            return (
                                <>
                                    <Title>{cat().name} — Forum</Title>
                                    <SeoHead title={cat().name} description={cat().description || undefined} />
                                    <nav class="forum__crumbs" aria-label="Breadcrumb">
                                        <A href="/forum">Forum</A><span>›</span><span>{cat().name}</span>
                                    </nav>
                                    <div class="forum__head">
                                        <div>
                                            <h1>{cat().name}</h1>
                                            <Show when={cat().description}><p class="forum__intro">{cat().description}</p></Show>
                                        </div>
                                        <Show when={cat().canPost && !composing()}>
                                            <button type="button" class="btn btn--primary" onClick={() => setComposing(true,)}>New thread</button>
                                        </Show>
                                        <Show when={!auth.user && !cat().locked}>
                                            <button type="button" class="btn btn--outline" onClick={() => setLogin(true,)}>Sign in to post</button>
                                        </Show>
                                    </div>

                                    <Show when={composing()}>
                                        <form class="forum__new" onSubmit={(e,) => { e.preventDefault(); void submit(cat().id,); }}>
                                            <input
                                                type="text"
                                                placeholder="Thread title"
                                                maxLength={200}
                                                value={title()}
                                                onInput={(e,) => setTitle(e.currentTarget.value,)}
                                            />
                                            <div class="comment-composer__tabs" role="tablist">
                                                <button type="button" classList={{ 'is-active': !preview(), }} onClick={() => setPreview(false,)}>Write</button>
                                                <button type="button" classList={{ 'is-active': preview(), }} onClick={() => setPreview(true,)}>Preview</button>
                                            </div>
                                            <Show
                                                when={preview()}
                                                fallback={
                                                    <textarea
                                                        placeholder="Write the first post (Markdown supported)…"
                                                        value={body()}
                                                        onInput={(e,) => setBody(e.currentTarget.value,)}
                                                    />
                                                }
                                            >
                                                <div class="comment-item__body rich-text" innerHTML={renderMarkdown(body(),) || '<p><em>Nothing to preview.</em></p>'} />
                                            </Show>
                                            <Show when={error()}><p class="forum__error">{error()}</p></Show>
                                            <div class="forum__new-actions">
                                                <button type="button" class="btn btn--outline" onClick={() => setComposing(false,)}>Cancel</button>
                                                <button type="submit" class="btn btn--primary" disabled={posting() || title().trim().length < 3 || !body().trim()}>
                                                    {posting() ? 'Posting…' : 'Post thread'}
                                                </button>
                                            </div>
                                        </form>
                                    </Show>

                                    <Show when={ok().data.threads.length} fallback={<div class="forum__notice"><p>No threads here yet.</p></div>}>
                                        <div class="forum__threads">
                                            <For each={ok().data.threads}>{(t,) => <ThreadRow t={t} />}</For>
                                        </div>
                                    </Show>

                                    <Show when={(ok().meta.totalPages ?? 1) > 1}>
                                        <div class="forum__pager">
                                            <button type="button" class="btn btn--outline" disabled={page() <= 1} onClick={() => setSearch({ page: String(page() - 1,), },)}>← Newer</button>
                                            <span>Page {page()} of {ok().meta.totalPages}</span>
                                            <button type="button" class="btn btn--outline" disabled={page() >= (ok().meta.totalPages ?? 1)} onClick={() => setSearch({ page: String(page() + 1,), },)}>Older →</button>
                                        </div>
                                    </Show>
                                </>
                            );
                        }}
                    </Show>
                )}
            </Show>
            <Show when={login()}>
                <LoginModal onClose={() => setLogin(false,)} onSuccess={() => { setLogin(false,); refetch(); }} />
            </Show>
        </div>
    );
};

export default ForumCategory;
