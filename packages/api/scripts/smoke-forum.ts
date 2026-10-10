/**
 * Local smoke test for the forum backend: enables Forum (auto-enables the
 * discussions base), starts a thread, replies through the engine, checks the
 * thread/category/activity counters, tier gating and thread moderation.
 * Usage: npm run smoke:forum   (dev DB with an admin + a member)
 */
import { query, closePool, } from '../src/db';
import { updateSettings, } from '../src/services/features/cascade';
import * as discussions from '../src/services/discussions';
import * as forum from '../src/services/forum';

const ctx = { userId: undefined, ipAddress: '127.0.0.1', userAgent: 'smoke', } as never;
const assert = (c: unknown, m: string,) => { if (!c) throw new Error(`FAIL: ${m}`,); console.log(`ok  ${m}`,); };

async function main() {
    await updateSettings({ features: { forum: true, }, }, ctx,);
    const admin = (await query<{ id: string; role: string; }>(`SELECT id, role FROM users WHERE role IN ('admin','sysadmin') LIMIT 1`,)).rows[0];
    const staff = { id: admin.id, role: admin.role, };
    const anon = { id: null, role: null, };
    const cats = await forum.listCategories(anon,);
    const general = cats.find((c,) => c.slug === 'general',);
    assert(general, 'seeded General category is listed',);

    const before = await discussions.activity.getActivity(admin.id,);
    const t = await forum.createThread({ categoryId: general!.id, title: 'Smoke thread', body: 'Hello **forum**', }, staff, '127.0.0.1',);
    assert(t.opening?.bodyHtml?.includes('<strong>',) && t.url.startsWith('/forum/general/',), 'thread created with opening post',);
    const r1 = await discussions.comments.create({ target: `forum_thread:${t.id}`, body: 'A reply', }, staff,);
    assert(r1.status === 'visible', 'reply posted through the engine',);

    const page = await forum.getThread('general', t.slug, anon, 'smoke-ip',);
    assert(page.replyCount === 1 && page.lastReplyBy?.name, 'thread reply counter + last reply',);
    const replies = await discussions.comments.list(`forum_thread:${t.id}`, anon, { sort: 'oldest', },);
    assert(replies.items.length === 1 && !replies.items.some((c,) => c.isOpening,), 'replies exclude the opening post',);
    const act = await discussions.activity.getActivity(admin.id,);
    assert(act.forumThreads === before.forumThreads + 1 && act.forumReplies === before.forumReplies + 1, 'activity counts thread + reply',);
    const cat = (await forum.listCategories(anon,)).find((c,) => c.id === general!.id,)!;
    assert(cat.threadCount >= 1 && cat.lastThread?.id === t.id, 'category counters + latest thread',);
    assert(!page.canReply && page.replyBlockedReason === 'Sign in to reply.', 'anonymous cannot reply',);

    // Tier-gated category: anonymous cannot read.
    await query(`UPDATE forum_categories SET read_min_rank = 1 WHERE id = $1`, [general!.id,],);
    let blocked = false;
    try { await forum.getThread('general', t.slug, anon, 'x',); } catch { blocked = true; }
    assert(blocked, 'tier-gated category refuses anonymous readers',);
    let leaked = true;
    try { await discussions.comments.list(`forum_thread:${t.id}`, anon,); } catch { leaked = false; }
    assert(!leaked, 'gated thread replies do not leak through the engine',);
    await query(`UPDATE forum_categories SET read_min_rank = NULL WHERE id = $1`, [general!.id,],);

    // Discovery sees the thread once the forum target is registered.
    const { query: discover, } = await import('../src/services/discussions/query');
    const feed = await discover({ kind: 'thread', sort: 'latest', limit: 10, } as never, anon,);
    const item = (feed as { items: Array<{ kind: string; id: string; url?: string; }>; }).items.find((i,) => i.kind === 'thread' && i.id === t.id,);
    assert(item && item.url === t.url, 'discovery lists the thread (latest)',);
    const hot = await discover({ kind: 'thread', sort: 'hot', window: '24h', limit: 10, } as never, anon,);
    assert((hot as { items: Array<{ id: string; }>; }).items.some((i,) => i.id === t.id,), 'discovery hot includes the active thread',);

    await forum.actOnThread(t.id, 'hide', staff,);
    const hiddenCat = (await forum.listCategories(anon,)).find((c,) => c.id === general!.id,)!;
    assert(hiddenCat.threadCount === cat.threadCount - 1, 'hiding a thread drops it from the category count',);
    let gone = false;
    try { await forum.getThread('general', t.slug, anon, 'x',); } catch { gone = true; }
    assert(gone, 'hidden thread 404s for the public',);

    await query(`DELETE FROM comments WHERE target_type = 'forum_thread' AND target_id = $1`, [t.id,],);
    await query(`DELETE FROM forum_threads WHERE id = $1`, [t.id,],);
    await forum.reconcile();
    await discussions.activity.reconcile();
    const end = await discussions.activity.getActivity(admin.id,);
    assert(end.forumThreads === before.forumThreads && end.forumReplies === before.forumReplies, 'reconcile restores counters',);
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
