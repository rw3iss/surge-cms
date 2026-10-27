/**
 * The `forum` CONTENT BLOCK — an in-page forum / live-discussion widget.
 *
 * ONE block covers reading AND writing:
 *   mode 'list'    threads from `binding` (entity type `forum_thread`): a fixed
 *                  selection (list/single) or a live query (filters `sort` /
 *                  `window` / `category`, + limit). Each thread is a card
 *                  (title, author, dates, excerpt or full body, counts,
 *                  reactions); optional inline replies under each card.
 *   mode 'thread'  ONE thread (`thread` = id or slug) as a chat stream: its
 *                  opening post, then its replies; posting = replying.
 *
 * Posting (`postMode`): 'off' | 'inline' (one chat-style input — the thread
 * title is derived from the message server-side) | 'form' (title + body) |
 * 'button' ("New post" opens the form). New threads go to the category
 * `forumBlockPostCategory()` picks: `postCategory`, else the query's
 * `category` filter. No category → no posting (the forum has no root).
 *
 * The SERVER decides every right (forum read rules, category minimums,
 * locks, approval, `forum.allowAnonymous`); `visibility` / `allowAnonymous`
 * here only shape the widget (a members-only block shows a sign-in
 * placeholder to visitors).
 *
 * Rendered by the web `ForumBlock` (+ `{{ forum(...) }}`), SSR / email as a
 * plain linked list of threads.
 */
import type { SlotBinding, } from '../entities/entityBlock';
import type { EntityQuery, } from '../entities/types';
import type { Comment, CommentAuthor, } from './discussions';

export type ForumBlockMode = 'list' | 'thread';
export type ForumPostMode = 'off' | 'inline' | 'form' | 'button';
export type ForumContentDisplay = 'none' | 'excerpt' | 'full';
/** latest = last activity (newest reply, else posted) · newest = date posted · hot · top. */
export type ForumFeedSort = 'latest' | 'newest' | 'hot' | 'top';
export type ForumFeedWindow = '24h' | '7d' | '30d' | 'all';
export type ForumBlockVisibility = 'public' | 'members';
export type ForumHeadingAlign = 'left' | 'center' | 'right';

export const FORUM_FEED_SORTS: readonly ForumFeedSort[] = ['latest', 'newest', 'hot', 'top',];
export const FORUM_FEED_WINDOWS: readonly ForumFeedWindow[] = ['24h', '7d', '30d', 'all',];

export interface ForumBlockSettings {
    mode?: ForumBlockMode;
    /** List mode: the threads (entity type `forum_thread`). */
    binding?: SlotBinding;
    /** Thread mode: one thread id or slug. */
    thread?: string;

    heading?: string;
    headingAlign?: ForumHeadingAlign;
    emptyText?: string;

    // ─── What each post shows ───
    showTitle?: boolean;
    showAuthor?: boolean;
    showAvatar?: boolean;
    showDate?: boolean;
    showLastReply?: boolean;
    showCategory?: boolean;
    /** Reply + view counts. */
    showCounts?: boolean;
    content?: ForumContentDisplay;
    /** Characters of the excerpt (content = excerpt). */
    excerptLength?: number;
    /** Link to the thread page ('' hides it). */
    readMoreLabel?: string;

    // ─── Layout ───
    /** Newest at the bottom, list scrolled to the end (chat style). */
    chatOrder?: boolean;
    /** Max height of the scrolling list when the block itself sets no height. */
    listMaxHeight?: string;
    /** Threads per load ("Load more" fetches the next page). */
    limit?: number;

    // ─── Writing ───
    postMode?: ForumPostMode;
    /** Category id or slug new threads go to (default: the query's category). */
    postCategory?: string;
    postPlaceholder?: string;
    /** Reply button on each post (opens a small reply form). */
    allowReplies?: boolean;
    /** "N replies" under each card loads the replies inline. */
    showReplies?: boolean;
    /** …opened by default. */
    expandReplies?: boolean;
    allowReactions?: boolean;

    // ─── Access + updates ───
    visibility?: ForumBlockVisibility;
    /** Offer guest posting (needs Forum → Settings → Allow anonymous posting). */
    allowAnonymous?: boolean;
    /** Poll for new posts while the page is visible. */
    liveUpdates?: boolean;
    /** Poll interval, seconds (10…300). */
    refreshSeconds?: number;
}

export const DEFAULT_FORUM_BLOCK_LIMIT = 20;
export const MAX_FORUM_BLOCK_LIMIT = 50;

/** Default data: the latest threads, every readable category. */
export const DEFAULT_FORUM_BINDING: SlotBinding = {
    mode: 'query', query: { filter: { sort: 'latest', }, limit: DEFAULT_FORUM_BLOCK_LIMIT, },
};

export const DEFAULT_FORUM_BLOCK_SETTINGS: {
    mode: ForumBlockMode; binding: SlotBinding; headingAlign: ForumHeadingAlign; showTitle: boolean; showAuthor: boolean;
    showAvatar: boolean; showDate: boolean; showLastReply: boolean; showCategory: boolean; showCounts: boolean;
    content: ForumContentDisplay; excerptLength: number; readMoreLabel: string; chatOrder: boolean; listMaxHeight: string;
    limit: number; postMode: ForumPostMode; postPlaceholder: string; allowReplies: boolean; showReplies: boolean;
    expandReplies: boolean; allowReactions: boolean; visibility: ForumBlockVisibility; allowAnonymous: boolean;
    liveUpdates: boolean; refreshSeconds: number;
} = {
    mode: 'list' as ForumBlockMode,
    binding: DEFAULT_FORUM_BINDING,
    headingAlign: 'left' as ForumHeadingAlign,
    showTitle: true,
    showAuthor: true,
    showAvatar: true,
    showDate: true,
    showLastReply: true,
    showCategory: false,
    showCounts: true,
    content: 'excerpt' as ForumContentDisplay,
    excerptLength: 220,
    readMoreLabel: 'Read more',
    chatOrder: false,
    listMaxHeight: '560px',
    limit: DEFAULT_FORUM_BLOCK_LIMIT,
    postMode: 'off' as ForumPostMode,
    postPlaceholder: '',
    allowReplies: false,
    showReplies: true,
    expandReplies: false,
    allowReactions: true,
    visibility: 'public' as ForumBlockVisibility,
    allowAnonymous: false,
    liveUpdates: true,
    refreshSeconds: 20,
};

export type ResolvedForumBlockSettings = typeof DEFAULT_FORUM_BLOCK_SETTINGS & {
    thread?: string;
    heading?: string;
    emptyText?: string;
    postCategory?: string;
};

const str = (v: unknown,): string => (typeof v === 'string' ? v.trim() : '');
const bool = (v: unknown, def: boolean,): boolean => (typeof v === 'boolean' ? v : def);
const int = (v: unknown, def: number, min: number, max: number,): number => {
    const n = Math.round(Number(v,),);
    return Number.isFinite(n,) && str(String(v ?? '',),) !== '' ? Math.max(min, Math.min(max, n,),) : def;
};
/** A CSS length (bare number = px); anything that could escape a declaration is refused. */
const cssLen = (v: unknown,): string | undefined => {
    const s = str(v,);
    if (!s || /[;{}<>"'\\]/.test(s,)) return undefined;
    return /^\d+(\.\d+)?$/.test(s,) ? `${s}px` : s;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T,): T => (list.includes(v as T,) ? v as T : def);

/** Saved / partial settings → every field resolved. */
export function normalizeForumBlockSettings(raw: unknown,): ResolvedForumBlockSettings {
    const s = (raw && typeof raw === 'object' ? raw : {}) as ForumBlockSettings;
    const d = DEFAULT_FORUM_BLOCK_SETTINGS;
    const binding = s.binding && typeof s.binding === 'object' && 'mode' in s.binding ? s.binding : d.binding;
    return {
        mode: oneOf(s.mode, ['list', 'thread',] as const, d.mode,),
        binding,
        thread: str(s.thread,) || undefined,
        heading: str(s.heading,) || undefined,
        headingAlign: oneOf(s.headingAlign, ['left', 'center', 'right',] as const, d.headingAlign,),
        emptyText: str(s.emptyText,) || undefined,
        showTitle: bool(s.showTitle, d.showTitle,),
        showAuthor: bool(s.showAuthor, d.showAuthor,),
        showAvatar: bool(s.showAvatar, d.showAvatar,),
        showDate: bool(s.showDate, d.showDate,),
        showLastReply: bool(s.showLastReply, d.showLastReply,),
        showCategory: bool(s.showCategory, d.showCategory,),
        showCounts: bool(s.showCounts, d.showCounts,),
        content: oneOf(s.content, ['none', 'excerpt', 'full',] as const, d.content,),
        excerptLength: int(s.excerptLength, d.excerptLength, 20, 5000,),
        readMoreLabel: typeof s.readMoreLabel === 'string' ? s.readMoreLabel.trim() : d.readMoreLabel,
        chatOrder: bool(s.chatOrder, d.chatOrder,),
        listMaxHeight: cssLen(s.listMaxHeight,) ?? d.listMaxHeight,
        limit: int(s.limit, d.limit, 1, MAX_FORUM_BLOCK_LIMIT,),
        postMode: oneOf(s.postMode, ['off', 'inline', 'form', 'button',] as const, d.postMode,),
        postCategory: str(s.postCategory,) || undefined,
        postPlaceholder: str(s.postPlaceholder,),
        allowReplies: bool(s.allowReplies, d.allowReplies,),
        showReplies: bool(s.showReplies, d.showReplies,),
        expandReplies: bool(s.expandReplies, d.expandReplies,),
        allowReactions: bool(s.allowReactions, d.allowReactions,),
        visibility: oneOf(s.visibility, ['public', 'members',] as const, d.visibility,),
        allowAnonymous: bool(s.allowAnonymous, d.allowAnonymous,),
        liveUpdates: bool(s.liveUpdates, d.liveUpdates,),
        refreshSeconds: int(s.refreshSeconds, d.refreshSeconds, 10, 300,),
    };
}

/** A filter value (bare or `{op, value}`) → its string. */
function filterValue(q: EntityQuery | undefined, key: string,): string | undefined {
    const raw = q?.filter?.[key] as unknown;
    const v = raw !== null && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown; }).value : raw;
    if (v === undefined || v === null) return undefined;
    const s = Array.isArray(v,) ? String(v[0] ?? '',) : String(v,);
    return s.trim() || undefined;
}

/**
 * Where a block's NEW threads go: `postCategory`, else the live query's
 * `category` filter, else none (posting is then unavailable — the forum has
 * no root category). A slug or an id; the server resolves either.
 */
export function forumBlockPostCategory(s: Pick<ResolvedForumBlockSettings, 'postCategory' | 'binding' | 'mode'>,): string | undefined {
    if (s.postCategory) return s.postCategory;
    if (s.mode === 'list' && s.binding.mode === 'query') return filterValue(s.binding.query, 'category',);
    return undefined;
}

/** GET /forum/feed query for a block's settings (list or thread mode). */
export function forumFeedQueryFor(s: ResolvedForumBlockSettings, page = 1,): ForumFeedQuery {
    const postCategory = forumBlockPostCategory(s,);
    const base: ForumFeedQuery = { page, limit: s.limit, ...(postCategory ? { postCategory, } : {}), };
    if (s.mode === 'thread') return { ...base, threads: s.thread ? [s.thread,] : [], limit: 1, page: 1, };
    const b = s.binding;
    if (b.mode === 'single') return { ...base, threads: [b.ref,], };
    if (b.mode === 'list') return { ...base, threads: b.refs.slice(0, MAX_FORUM_BLOCK_LIMIT,), };
    const sort = filterValue(b.query, 'sort',);
    const window = filterValue(b.query, 'window',);
    const category = filterValue(b.query, 'category',);
    const limit = Number(b.query.limit,);
    return {
        ...base,
        sort: (FORUM_FEED_SORTS as readonly string[]).includes(sort ?? '',) ? sort as ForumFeedSort
            : b.query.sortBy === 'createdAt' ? 'newest' : 'latest',
        ...((FORUM_FEED_WINDOWS as readonly string[]).includes(window ?? '',) ? { window: window as ForumFeedWindow, } : {}),
        ...(category ? { category, } : {}),
        // An explicit block limit wins over the query's.
        limit: s.limit !== DEFAULT_FORUM_BLOCK_LIMIT || !Number.isFinite(limit,) || limit <= 0
            ? s.limit : Math.min(MAX_FORUM_BLOCK_LIMIT, Math.round(limit,),),
    };
}

/**
 * A thread title from a chat-style message (inline posting has no title
 * field): the first line, cut at a word boundary to ≤ `max` chars; a message
 * too short for a title (< 3 chars) gets `fallback`.
 */
export function deriveThreadTitle(body: string, fallback = 'New post', max = 80,): string {
    const first = String(body ?? '',).replace(/[#>*_`~[\]()!-]+/g, ' ',).split(/\r?\n/,).map((l,) => l.replace(/\s+/g, ' ',).trim(),).find(Boolean,) ?? '';
    let title = first;
    if (title.length > max) {
        const cut = title.slice(0, max,);
        const sp = cut.lastIndexOf(' ',);
        title = `${(sp > max * 0.5 ? cut.slice(0, sp,) : cut).trim()}…`;
    }
    return title.length >= 3 ? title : fallback;
}

// ─── GET /forum/feed (DTOs live here so the block, SDK and server share them) ───

/** `GET /forum/feed` — threads for a forum block, shaped for the viewer. */
export interface ForumFeedQuery {
    /** Specific threads (ids or slugs), in this order. Overrides sort/category/window. */
    threads?: string[];
    /** Default `latest`. */
    sort?: ForumFeedSort;
    /** Default all time for latest/newest, 7d for hot/top. */
    window?: ForumFeedWindow;
    /** Category slug or id. A hidden-from-index category is only listed when named here. */
    category?: string;
    /** Category (slug or id) new posts go to → `postTarget`. */
    postCategory?: string;
    page?: number;
    /** ≤ 50. Default 20. */
    limit?: number;
}

/** One thread in a forum block. */
export interface ForumFeedThread {
    id: string;
    slug: string;
    title: string;
    /** `/forum/<category>/<thread>` */
    url: string;
    category: { id: string; slug: string; name: string; };
    author: CommentAuthor;
    /** The opening post (body html, reactions, viewer rights); null if unavailable. */
    opening: Comment | null;
    /** Plain-text start of the opening post (≤ 500 chars). */
    excerpt: string;
    status: 'visible' | 'pending';
    pinned: boolean;
    locked: boolean;
    replyCount: number;
    viewCount: number;
    reactionCount: number;
    lastReplyAt: string | null;
    lastReplyBy: { name: string; handle: string | null; } | null;
    createdAt: string;
    /** May the viewer reply (and why not). */
    canReply: boolean;
    replyBlockedReason: string | null;
}

/** Where the block's new threads go, for this viewer. */
export interface ForumFeedPostTarget {
    categoryId: string;
    categorySlug: string;
    categoryName: string;
    /** May the viewer start a thread there now (signed in, rank, not locked). */
    canPost: boolean;
    /** Why not (shown under the disabled form). */
    reason: string | null;
    /** Guests may post here (Forum → Settings → Allow anonymous posting + permission). */
    anonymous: boolean;
}

export interface ForumFeedResponse {
    items: ForumFeedThread[];
    page: number;
    limit: number;
    /** Upper bound (unreadable threads are dropped after counting). */
    total: number;
    /** Null when no `postCategory` was asked for or it does not exist. */
    postTarget: ForumFeedPostTarget | null;
    /** Guests may reply / post anywhere the forum allows it. */
    anonymousAllowed: boolean;
    /** Engine limits the composer needs. */
    maxLength: number;
    reactions: string[];
    reactionsEnabled: boolean;
}
