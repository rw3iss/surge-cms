/**
 * `{{ forum(...) }}` — the Forum block as a template function. ONE mapping
 * from a call to `ForumBlockSettings`, shared by the site (renders the live
 * widget), SSR and email (a linked list of the threads), so the function and
 * the block can never read the same option two ways.
 *
 *   {{ forum() }}                                        latest threads, read-only
 *   {{ forum(10, category='discussions', post='inline', replies=true) }}
 *   {{ forum(category='discussions', sort='hot', window='7d', content='full') }}
 *   {{ forum(threads='welcome,rules') }}                 these threads, in order
 *   {{ forum(thread='ask-us-anything', post=true) }}     one thread as a chat stream; posting replies
 *   {{ forum(category='discussions', chat=true, height='420px', members=true) }}
 *
 * Arguments (all optional; a bare first number = limit):
 *   thread · threads · category · sort (latest|newest|hot|top) · window (24h|7d|30d|all) · limit
 *   post (off|inline|form|button; true = inline) · postTo (category for new threads) · placeholder
 *   replies (reply buttons) · showReplies · expandReplies · reactions
 *   content (none|excerpt|full) · excerptLength · readMore ('' / false hides the link)
 *   style (full|minimal — minimal = chat bubbles)
 *   title · author · avatar · date · lastReply · categoryName · replyCount · views   (show/hide each field;
 *   counts=false hides both counts)
 *   chat (newest at the bottom) · height (list max height) · heading · subheading · emptyText
 *   members (true = members only) · anonymous (guest posting) · live · refresh (seconds)
 *
 * Result: `entityRef(FORUM_BLOCK_KIND, settings)`.
 */
import type { SlotBinding, } from '../entities/entityBlock';
import type { EntityQuery, } from '../entities/types';
import {
    DEFAULT_FORUM_BLOCK_LIMIT, type ForumBlockSettings, type ForumContentDisplay, type ForumPostMode, MAX_FORUM_BLOCK_LIMIT,
} from '../types/forumBlock';

/** Whole-entity kind of a `forum(...)` call (data = ForumBlockSettings). */
export const FORUM_BLOCK_KIND = 'forumBlock';
export const FORUM_FUNCTION_NAMES = ['forum',] as const;

const str = (v: unknown,) => (v === undefined || v === null ? '' : String(v,).trim());
const num = (v: unknown,): number | undefined => {
    const n = Number(v,);
    return Number.isFinite(n,) && str(v,) !== '' ? n : undefined;
};
const bool = (v: unknown,): boolean | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (v === false || v === 'false' || v === 0 || v === '0' || v === 'no' || v === 'off') return false;
    return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes' || v === 'on' ? true : undefined;
};

const POST_MODES: readonly ForumPostMode[] = ['off', 'inline', 'form', 'button',];
const CONTENT: readonly ForumContentDisplay[] = ['none', 'excerpt', 'full',];

/** `forum(...)` → block settings, or null when `name` is not `forum`. */
export function forumBlockSettingsFrom(name: string, args: unknown[], named: Record<string, unknown> = {},): ForumBlockSettings | null {
    if (name !== 'forum') return null;
    const s: ForumBlockSettings = {};

    let limit: number | undefined;
    for (const a of args) if (num(a,) !== undefined) limit = num(a,);
    if (num(named.limit,) !== undefined) limit = num(named.limit,);
    if (limit !== undefined) s.limit = Math.max(1, Math.min(MAX_FORUM_BLOCK_LIMIT, Math.round(limit,),),);

    const thread = str(named.thread,);
    const threads = str(named.threads ?? named.ids,).split(',',).map((x,) => x.trim()).filter(Boolean,);
    if (thread) {
        s.mode = 'thread';
        s.thread = thread;
    } else if (threads.length) {
        s.binding = { mode: 'list', refs: threads.slice(0, MAX_FORUM_BLOCK_LIMIT,), };
    } else {
        const filter: NonNullable<EntityQuery['filter']> = { sort: str(named.sort,) || 'latest', };
        if (str(named.window,)) filter.window = str(named.window,);
        if (str(named.category,)) filter.category = str(named.category,);
        s.binding = { mode: 'query', query: { filter, limit: s.limit ?? DEFAULT_FORUM_BLOCK_LIMIT, }, } satisfies SlotBinding;
    }

    const post = named.post;
    const postBool = bool(post,);
    if (postBool !== undefined) s.postMode = postBool ? 'inline' : 'off';
    else if (POST_MODES.includes(str(post,) as ForumPostMode,)) s.postMode = str(post,) as ForumPostMode;
    if (str(named.postTo ?? named.postCategory,)) s.postCategory = str(named.postTo ?? named.postCategory,);
    if (str(named.placeholder,)) s.postPlaceholder = str(named.placeholder,);

    const flags: [keyof ForumBlockSettings, unknown,][] = [
        ['allowReplies', named.replies ?? named.allowReplies,],
        ['showReplies', named.showReplies,],
        ['expandReplies', named.expandReplies,],
        ['allowReactions', named.reactions,],
        ['showTitle', named.title ?? named.showTitle,],
        ['showAuthor', named.author ?? named.showAuthor,],
        ['showAvatar', named.avatar ?? named.showAvatar,],
        ['showDate', named.date ?? named.showDate,],
        ['showLastReply', named.lastReply ?? named.showLastReply,],
        ['showCategory', named.categoryName ?? named.showCategory,],
        ['showReplyCount', named.replyCount ?? named.showReplyCount ?? named.counts,],
        ['showViewCount', named.views ?? named.viewCount ?? named.showViewCount ?? named.counts,],
        ['chatOrder', named.chat ?? named.chatOrder,],
        ['allowAnonymous', named.anonymous,],
        ['liveUpdates', named.live,],
    ];
    for (const [k, v,] of flags) {
        const b = bool(v,);
        if (b !== undefined) (s as Record<string, unknown>)[k] = b;
    }
    if (str(named.style ?? named.threadStyle,) === 'minimal' || str(named.style ?? named.threadStyle,) === 'chat') s.threadStyle = 'minimal';
    else if (str(named.style ?? named.threadStyle,) === 'full') s.threadStyle = 'full';
    if (CONTENT.includes(str(named.content,) as ForumContentDisplay,)) s.content = str(named.content,) as ForumContentDisplay;
    if (num(named.excerptLength ?? named.length,) !== undefined) s.excerptLength = num(named.excerptLength ?? named.length,);
    if (named.readMore !== undefined) s.readMoreLabel = bool(named.readMore,) === false ? '' : str(named.readMore,);
    if (str(named.height,)) s.listMaxHeight = str(named.height,);
    if (str(named.heading,)) s.heading = str(named.heading,);
    if (str(named.subheading ?? named.intro,)) s.subheading = str(named.subheading ?? named.intro,);
    if (str(named.emptyText ?? named.empty,)) s.emptyText = str(named.emptyText ?? named.empty,);
    if (bool(named.members,) === true || str(named.visibility,) === 'members') s.visibility = 'members';
    if (num(named.refresh,) !== undefined) s.refreshSeconds = num(named.refresh,);
    return s;
}
