/**
 * A list of discovery items (comments + forum threads) — what a bare
 * `{{ hotThreads(5) }}` / `{{ latestComments(5) }}` renders on the site, and
 * reusable anywhere a "latest / hottest discussions" list is wanted.
 * Items come from `cms.discussions.query` (already filtered to what the viewer
 * may read). Author names link to the member page's Comments tab.
 */
import type { DiscussionCommentItem, DiscussionItem, DiscussionThreadItem, } from '@sitesurge/types';
import { formatRelativeTime, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, For, Match, Show, Switch, } from 'solid-js';
import './DiscussionList.scss';

export interface DiscussionListProps {
    items: DiscussionItem[];
    /** Show comment / opening-post excerpts. Default true. */
    excerpts?: boolean;
    /** Text when there is nothing to show. Default: nothing rendered. */
    emptyText?: string;
    class?: string;
}

const AuthorLink: Component<{ name: string; handle: string | null; }> = (p,) => (
    <Show when={p.handle} fallback={<span class="discussion-list__author">{p.name}</span>}>
        <A class="discussion-list__author" href={`/members/${p.handle}?tab=comments`}>{p.name}</A>
    </Show>
);

const ThreadRow: Component<{ t: DiscussionThreadItem; excerpts: boolean; }> = (p,) => (
    <li class="discussion-list__item discussion-list__item--thread">
        <A class="discussion-list__title" href={p.t.url}>{p.t.title}</A>
        <div class="discussion-list__meta">
            <A class="discussion-list__category" href={`/forum/${p.t.category.slug}`}>{p.t.category.name}</A>
            <span aria-hidden="true">·</span>
            <AuthorLink name={p.t.author.name} handle={p.t.author.handle} />
            <span aria-hidden="true">·</span>
            <span>{p.t.replyCount} {p.t.replyCount === 1 ? 'reply' : 'replies'}</span>
            <span aria-hidden="true">·</span>
            <time datetime={p.t.lastReplyAt ?? p.t.createdAt}>{formatRelativeTime(p.t.lastReplyAt ?? p.t.createdAt,)}</time>
        </div>
        <Show when={p.excerpts && p.t.excerpt}>
            <p class="discussion-list__excerpt">{p.t.excerpt}</p>
        </Show>
    </li>
);

const CommentRow: Component<{ c: DiscussionCommentItem; excerpts: boolean; }> = (p,) => (
    <li class="discussion-list__item discussion-list__item--comment">
        <div class="discussion-list__meta">
            <AuthorLink name={p.c.author.name} handle={p.c.author.handle} />
            <Show when={p.c.target}>
                {(t,) => (
                    <>
                        <span>on</span>
                        <A class="discussion-list__target" href={p.c.url || t().url}>{t().title}</A>
                    </>
                )}
            </Show>
            <span aria-hidden="true">·</span>
            <time datetime={p.c.createdAt}>{formatRelativeTime(p.c.createdAt,)}</time>
        </div>
        <Show when={p.excerpts && p.c.excerpt}>
            <A class="discussion-list__excerpt discussion-list__excerpt--link" href={p.c.url}>{p.c.excerpt}</A>
        </Show>
    </li>
);

const DiscussionList: Component<DiscussionListProps> = (props,) => {
    const excerpts = () => props.excerpts !== false;
    return (
        <Show when={props.items.length} fallback={props.emptyText ? <p class="discussion-list__empty">{props.emptyText}</p> : null}>
            <ul class={`discussion-list${props.class ? ` ${props.class}` : ''}`}>
                <For each={props.items}>
                    {(item,) => (
                        <Switch>
                            <Match when={item.kind === 'thread'}>
                                <ThreadRow t={item as DiscussionThreadItem} excerpts={excerpts()} />
                            </Match>
                            <Match when={item.kind === 'comment'}>
                                <CommentRow c={item as DiscussionCommentItem} excerpts={excerpts()} />
                            </Match>
                        </Switch>
                    )}
                </For>
            </ul>
        </Show>
    );
};

export default DiscussionList;
