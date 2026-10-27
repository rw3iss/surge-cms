/**
 * Pure helpers behind the Forum widget (list + thread mode): merging polled
 * pages by id, display order, excerpts, scroll position and "is anyone
 * typing". No Solid, no DOM writes — unit-tested in forumFeed.test.ts.
 */

/** Merge a fresh FIRST page into what is shown: the fresh rows first (their
 *  order = the server's sort, so a bumped thread moves up), then every row
 *  already shown that the fresh page does not carry (older pages). `added` =
 *  ids that were not shown before (to animate them in). */
export function mergeById<T extends { id: string; }>(prev: readonly T[], fresh: readonly T[],): { items: T[]; added: string[]; } {
    const seen = new Set(prev.map((x,) => x.id),);
    const freshIds = new Set(fresh.map((x,) => x.id),);
    return {
        items: [...fresh, ...prev.filter((x,) => !freshIds.has(x.id,)),],
        added: fresh.filter((x,) => !seen.has(x.id,)).map((x,) => x.id),
    };
}

/** Append an older page, skipping rows already shown (a row can shift pages
 *  between requests when new posts arrive). */
export function appendPage<T extends { id: string; }>(prev: readonly T[], page: readonly T[],): T[] {
    const seen = new Set(prev.map((x,) => x.id),);
    return [...prev, ...page.filter((x,) => !seen.has(x.id,)),];
}

/** Rows in display order: the server's order (newest first), or reversed for
 *  chat order (newest at the bottom). Never mutates. */
export function displayOrder<T>(items: readonly T[], chatOrder: boolean,): T[] {
    return chatOrder ? [...items,].reverse() : [...items,];
}

/** More pages to load? */
export function hasMorePages(page: number, limit: number, total: number,): boolean {
    return page * limit < total;
}

/** Plain text cut to `max` characters at a word boundary, with "…". */
export function clipText(text: string | null | undefined, max: number,): string {
    const t = String(text ?? '',).replace(/\s+/g, ' ',).trim();
    if (!max || t.length <= max) return t;
    const cut = t.slice(0, max,);
    const sp = cut.lastIndexOf(' ',);
    return `${(sp > max * 0.6 ? cut.slice(0, sp,) : cut).replace(/[\s.,;:!?-]+$/, '',)}…`;
}

/** Within `threshold` px of the end of a scroll box. */
export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 80,): boolean {
    return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

/** A field that should pause live updates: focused, or holding text. The
 *  honeypot (`website`) never counts. */
export interface TypingField { focused: boolean; value: string; name?: string; }

export function someoneTyping(fields: readonly TypingField[],): boolean {
    return fields.some((f,) => f.name !== 'website' && (f.focused || f.value.trim() !== ''));
}

/** "1 reply" / "3 replies". */
export function countLabel(n: number, one: string, many: string,): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Clamp the poll interval (seconds → ms). */
export function pollIntervalMs(seconds: number,): number {
    const s = Number.isFinite(seconds,) ? seconds : 20;
    return Math.max(10, Math.min(300, s,),) * 1000;
}

/** What the viewer may do about replying to a thread: write, be asked to log in, or nothing.
 *  A guest writes only when the block offers guest posting (`guestWriting`). */
export type ForumWriteAccess = 'write' | 'login' | null;

export function replyAccess(thread: { locked: boolean; canReply: boolean; }, signedIn: boolean, guestWriting: boolean,): ForumWriteAccess {
    if (thread.locked) return null;
    if (signedIn) return thread.canReply ? 'write' : null;
    return guestWriting ? 'write' : 'login';
}

/**
 * Starting a thread from the block:
 *   none     the block has no category to post into (admin-only notice)
 *   write    show the composer
 *   login    signed out (and no guest posting) → "Log in to post"
 *   blocked  signed in but not allowed (show the server's reason)
 */
export type ForumPostAccess = 'none' | 'write' | 'login' | 'blocked';

export function postAccess(
    target: { canPost: boolean; anonymous: boolean; } | null | undefined, signedIn: boolean, blockAllowsGuests: boolean,
): ForumPostAccess {
    if (!target) return 'none';
    if (signedIn) return target.canPost ? 'write' : 'blocked';
    if (blockAllowsGuests && target.anonymous) return 'write';
    return 'login';
}
