/**
 * /forum — the forum's categories with counts and the latest thread in each.
 * A forum closed to the viewer (members / tier) explains how to get in.
 */
import type { ForumCategory, ForumSettings, } from '@sitesurge/types';
import { formatRelativeTime, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import LoginModal from '../../components/auth/LoginModal';
import Markdown from '../../components/common/Markdown';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import NotFoundPage from '../NotFound';
import './forum.scss';

const ForumIndex: Component = () => {
    const auth = useAuth();
    const [login, setLogin,] = createSignal(false,);
    const [settings,] = createResource(() => cms.forum.settings().catch(() => null as ForumSettings | null),);
    const [cats, { refetch, },] = createResource(
        () => auth.user?.id ?? 'anon',
        () => cms.forum.categories.list().catch(() => null as ForumCategory[] | null),
    );

    return (
        <div class="forum page-wrapper">
            <Show when={settings() !== undefined && cats() !== undefined} fallback={<p>Loading…</p>}>
                <Show when={settings()} fallback={<NotFoundPage />}>
                    {(s,) => (
                        <>
                            <Title>{s().title || 'Forum'}</Title>
                            <SeoHead title={s().title || 'Forum'} description={s().description || undefined} />
                            <div class="forum__head">
                                <div>
                                    <h1>{s().title || 'Forum'}</h1>
                                    <Show when={s().description}>
                                        <Markdown text={s().description} class="forum__intro" />
                                    </Show>
                                </div>
                            </div>

                            <Show
                                when={(cats() ?? []).length}
                                fallback={
                                    <div class="forum__notice">
                                        <Show
                                            when={!auth.user}
                                            fallback={<p>There is nothing here you can read yet.</p>}
                                        >
                                            <p>
                                                <a href="#" onClick={(e,) => { e.preventDefault(); setLogin(true,); }}>Sign in</a> to read the forum.
                                            </p>
                                        </Show>
                                    </div>
                                }
                            >
                                <div class="forum__categories">
                                    <For each={cats() ?? []}>
                                        {(c,) => (
                                            <div class="forum__category">
                                                <div>
                                                    <h2>
                                                        <A href={`/forum/${c.slug}`}>{c.name}</A>
                                                        <Show when={c.locked}><span class="forum__badges" title="Locked">🔒</span></Show>
                                                    </h2>
                                                    <Show when={c.description}><p>{c.description}</p></Show>
                                                </div>
                                                <div class="forum__counts">
                                                    <span><strong>{c.threadCount}</strong> threads</span>
                                                    <span><strong>{c.postCount}</strong> posts</span>
                                                </div>
                                                <div class="forum__latest">
                                                    <Show when={c.lastThread} fallback={<span>No threads yet</span>}>
                                                        {(t,) => (
                                                            <>
                                                                <A href={`/forum/${c.slug}/${t().slug}`}>{t().title}</A>
                                                                <span>
                                                                    {t().author ? `${t().author} · ` : ''}
                                                                    {c.lastPostAt ? formatRelativeTime(c.lastPostAt,) : ''}
                                                                </span>
                                                            </>
                                                        )}
                                                    </Show>
                                                </div>
                                            </div>
                                        )}
                                    </For>
                                </div>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
            <Show when={login()}>
                <LoginModal onClose={() => setLogin(false,)} onSuccess={() => { setLogin(false,); refetch(); }} />
            </Show>
        </div>
    );
};

export default ForumIndex;
