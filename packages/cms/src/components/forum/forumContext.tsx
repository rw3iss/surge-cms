/**
 * What every part of one Forum widget shares (settings, feed limits, who is
 * viewing, the login prompt, the notice line) — provided by ForumWidget, read
 * by the cards, replies, messages and composers.
 */
import type { Comment, ResolvedForumBlockSettings, } from '@sitesurge/types';
import { Component, createContext, Show, useContext, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { userInitials, } from '../../utils/userInitials';
import type { ForumComposerInput, } from './ForumComposer';
import type { ForumFeedMeta, } from './forumHooks';

export interface ForumWidgetCtx {
    settings: () => ResolvedForumBlockSettings;
    meta: () => ForumFeedMeta | null;
    signedIn: () => boolean;
    /** Guests may write here (block option + forum setting), and the viewer is one. */
    guestWriting: () => boolean;
    /** Admin preview: shown, not usable. */
    readOnly: () => boolean;
    /** Reaction kinds offered (empty = reactions off). */
    reactionKinds: () => string[];
    requestLogin: (title?: string,) => void;
    notify: (text: string,) => void;
    /** Re-read the feed (counts, last reply). */
    refreshFeed: () => void;
    /** Changes on sign-in / out. */
    viewer: () => string;
    /** Poll for new posts now (setting on, site — not the editor — and no error). */
    live: () => boolean;
    /** Someone is typing in this widget (live updates wait). */
    typing: () => boolean;
}

export const ForumContext = createContext<ForumWidgetCtx>();

export function useForum(): ForumWidgetCtx {
    const ctx = useContext(ForumContext,);
    if (!ctx) throw new Error('useForum() outside a ForumWidget',);
    return ctx;
}

/** Post a reply to a thread (or to one of its messages) and say how it went. */
export async function postForumReply(ctx: ForumWidgetCtx, threadId: string, parentId: string | null, input: ForumComposerInput,): Promise<Comment> {
    const c = await cms.discussions.create({
        target: `forum_thread:${threadId}`,
        parentId,
        body: input.body,
        ...(ctx.signedIn() ? {} : { guestName: input.guestName, website: input.website, }),
    },);
    ctx.notify(c.status === 'pending' ? 'Thanks — your reply will appear once it is approved.' : 'Reply posted',);
    return c;
}

/** Round avatar (picture or initials). */
export const ForumAvatar: Component<{ name: string; src?: string | null; size?: 'sm' | 'md'; }> = (props,) => (
    <Show
        when={props.src}
        fallback={<span class={`forum-avatar forum-avatar--${props.size ?? 'md'} forum-avatar--initials`} aria-hidden="true">{userInitials(props.name,)}</span>}
    >
        {(src,) => <img class={`forum-avatar forum-avatar--${props.size ?? 'md'}`} src={src()} alt="" loading="lazy" />}
    </Show>
);
