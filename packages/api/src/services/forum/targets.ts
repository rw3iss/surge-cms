/**
 * The `forum_thread` comment target: replies to a thread are discussion
 * comments, so the engine asks this module who may read / reply and keeps
 * the thread + category counters in step through it.
 */
import { query, } from '../../db';
import * as permissions from '../permissions';
import { onDiscussionEvent, } from '../discussions/events';
import { registerCommentTarget, type TargetAccess, } from '../discussions/targets';
import { isModerator, type Viewer, } from '../discussions/viewer';
import { canGuestReplyCategory, canReadCategory, canReplyCategory, viewerLevel, } from './access';
import { forumNeedsApproval, onForumCount, reconcile, syncThreadStatus, threadUrl, } from './forum';
import { getSettings, } from './settings';

interface Row {
    id: string; title: string; slug: string; status: string; locked: boolean; author_id: string | null;
    c_slug: string; read_min_rank: number | null; post_min_rank: number | null; c_locked: boolean;
}

async function moderates(v: Viewer,): Promise<boolean> {
    if (!v.id) return false;
    return (await isModerator(v,)) || permissions.can(v, 'forum:moderate',).catch(() => false);
}

const ACCESS_SELECT = `SELECT t.id, t.title, t.slug, t.status, t.locked, t.author_id,
        fc.slug AS c_slug, fc.read_min_rank, fc.post_min_rank, fc.locked AS c_locked
   FROM forum_threads t JOIN forum_categories fc ON fc.id = t.category_id WHERE t.id = ANY($1::uuid[])`;

/** Access for many threads in ONE query (viewer level, settings and moderator check resolved once). */
async function accessMany(ids: string[], viewer: Viewer,): Promise<Map<string, TargetAccess | null>> {
    const out = new Map<string, TargetAccess | null>();
    const valid = ids.filter((id,) => /^[0-9a-f-]{36}$/i.test(id,));
    if (!valid.length) return out;
    const rows = (await query<Row>(ACCESS_SELECT, [valid,],)).rows;
    if (!rows.length) return out;
    const [mod, s, level,] = await Promise.all([moderates(viewer,), getSettings(), viewerLevel(viewer,),],);
    for (const r of rows) out.set(r.id, decide(r, viewer, mod, s, level,),);
    return out;
}

function decide(r: Row, viewer: Viewer, mod: boolean, s: Awaited<ReturnType<typeof getSettings>>, level: number,): TargetAccess | null {
    const own = Boolean(viewer.id,) && r.author_id === viewer.id;
    if (r.status !== 'visible' && !mod && !(own && r.status === 'pending')) return null;
    const cat = { read_min_rank: r.read_min_rank, post_min_rank: r.post_min_rank, locked: r.c_locked, };
    // Guests may reply where Allow anonymous posting is on and the category is open to them
    // (the engine still checks `forum:post_anonymous`).
    const guestOk = canGuestReplyCategory(s, cat,);
    const base = { title: r.title, url: threadUrl(r.c_slug, r.slug,), allowAnonymous: guestOk, };
    if (mod) return { ...base, canRead: true, canComment: r.status === 'visible', };
    if (!canReadCategory(level, s, cat,)) {
        return { ...base, canRead: false, canComment: false, reason: level < 0 ? 'Sign in to read the forum.' : 'This part of the forum is for subscribers.', };
    }
    if (r.locked || r.c_locked) return { ...base, canRead: true, canComment: false, reason: 'This thread is locked.', };
    if (r.status !== 'visible') return { ...base, canRead: true, canComment: false, reason: 'This thread is awaiting approval.', };
    const ok = level < 0 ? guestOk : canReplyCategory(level, s, cat,);
    return { ...base, canRead: true, canComment: ok, reason: ok ? undefined : (level < 0 ? 'Sign in to reply.' : 'Replying here needs a higher subscription.'), };
}

registerCommentTarget({
    type: 'forum_thread',
    feature: 'forum',
    writePermission: 'forum:reply',
    anonymousPermission: 'forum:post_anonymous',
    async access(id, viewer,) {
        return (await accessMany([id,], viewer,)).get(id,) ?? null;
    },
    accessMany,
    async summaries(ids,) {
        const r = await query<{ id: string; title: string; slug: string; c_slug: string; }>(
            `SELECT t.id, t.title, t.slug, fc.slug AS c_slug FROM forum_threads t JOIN forum_categories fc ON fc.id = t.category_id
              WHERE t.id = ANY($1::uuid[])`,
            [ids,],
        );
        return new Map(r.rows.map((t,) => [t.id, { title: t.title, url: threadUrl(t.c_slug, t.slug,), },],),);
    },
    activityKind: (isOpening,) => (isOpening ? 'forum_threads' : 'forum_replies'),
    needsApproval: async (viewer, isGuest,) => {
        if (!isGuest) return forumNeedsApproval(viewer,);
        const s = await getSettings();
        return s.anonymousApproval || s.approveAll;
    },
    onCountChange: (client, id, delta, c,) => onForumCount(client as never, id, delta, c,),
    reconcile,
},);

// The opening post moderated from the shared queue → the thread follows it.
onDiscussionEvent(async (e,) => {
    if (e.comment.target_type !== 'forum_thread' || !e.comment.is_opening) return;
    if (['approved', 'restored', 'hidden', 'deleted',].includes(e.type,)) {
        await syncThreadStatus(e.comment.target_id, e.comment.status as never,);
    }
},);
