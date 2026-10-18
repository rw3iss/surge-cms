/**
 * Which moderation view a viewer opens on.
 *
 * Mirrors the server's `moderationScope` (`services/discussions/moderation.ts`):
 * `discussions:moderate` = everything; `forum:moderate` alone = forum posts
 * only. A forum-only moderator therefore defaults to the Forum view — the
 * server scopes their reads to the forum anyway, so the Comments view would
 * show forum posts under the wrong title.
 */
export function isForumOnlyModerator(perms: Record<string, boolean> | null | undefined,): boolean {
    return !!perms && !perms['discussions:moderate'] && !!perms['forum:moderate'];
}

export function moderationViewScope(param: string | undefined, forumOnly: boolean,): 'comments' | 'forum' {
    return param === 'forum' || forumOnly ? 'forum' : 'comments';
}
