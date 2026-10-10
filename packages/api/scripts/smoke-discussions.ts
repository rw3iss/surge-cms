/**
 * Local smoke test for the discussion engine: enables Comments (which must
 * auto-enable the hidden `discussions` base), opens commenting on a published
 * post, then posts / replies / reacts / edits / deletes and checks the counters.
 * Usage: npx tsx scripts/smoke-discussions.ts   (needs a dev DB with a published post + admin)
 */
import { query, closePool, } from '../src/db';
import { updateSettings, } from '../src/services/features/cascade';
import * as discussions from '../src/services/discussions';
import * as threads from '../src/services/comments/threads';

const ctx = { userId: undefined, ipAddress: '127.0.0.1', userAgent: 'smoke', } as never;
const assert = (c: unknown, m: string,) => { if (!c) throw new Error(`FAIL: ${m}`,); console.log(`ok  ${m}`,); };

async function main() {
    const r = await updateSettings({ features: { comments: true, }, }, ctx,);
    console.log('enable →', JSON.stringify(r,).slice(0, 300,),);
    const on = await query<{ key: string; value: unknown; }>(`SELECT key, value FROM site_settings WHERE key IN ('discussions_enabled','comments_enabled')`,);
    assert(on.rows.length === 2, 'discussions + comments enabled together',);

    const admin = (await query<{ id: string; role: string; }>(`SELECT id, role FROM users WHERE role IN ('admin','sysadmin') LIMIT 1`,)).rows[0];
    const post = (await query<{ id: string; }>(`SELECT id FROM posts WHERE status = 'published' AND is_private = false AND required_tier_id IS NULL LIMIT 1`,)).rows[0];
    const viewer = { id: admin.id, role: admin.role, };
    const target = `post:${post.id}` as const;

    await threads.update('post', post.id, { enabled: true, },);
    const before = (await discussions.activity.getActivity(admin.id,)).total;

    const c1 = await discussions.comments.create({ target, body: 'First **comment**', }, viewer,);
    assert(c1.status === 'visible' && c1.bodyHtml?.includes('<strong>',), 'create renders markdown',);
    const c2 = await discussions.comments.create({ target, body: 'A reply', parentId: c1.id, }, viewer,);
    assert(c2.depth === 1 && c2.rootId === c1.id, 'reply nests',);

    const list = await discussions.comments.list(target, viewer,);
    const top = list.items.find((c,) => c.id === c1.id,);
    assert(top?.replies?.[0]?.id === c2.id && top.replyCount === 1, 'list returns tree + reply count',);
    assert((await discussions.activity.getActivity(admin.id,)).total === before + 2, 'activity +2',);
    assert((await threads.get('post', post.id,)).commentCount >= 2, 'thread counter bumped',);

    const rx = await discussions.moderation.react(c1.id, '👍', viewer,);
    assert(rx.reactions['👍'] === 1 && rx.myReactions.includes('👍',), 'reaction toggles on',);
    const rx2 = await discussions.moderation.react(c1.id, '👍', viewer,);
    assert(!rx2.reactions['👍'], 'reaction toggles off',);

    const ed = await discussions.comments.update(c1.id, 'Edited', viewer,);
    assert(ed.editCount === 1 && ed.editedAt, 'edit tracked',);

    await discussions.comments.remove(c1.id, viewer,);
    const after = await discussions.comments.list(target, { id: null, role: null, },);
    const ghost = after.items.find((c,) => c.id === c1.id,);
    assert(ghost && ghost.body === null && ghost.author.name === '[deleted]' && ghost.replies?.length === 1, 'deleted parent stays as placeholder for anonymous viewer',);
    assert((await discussions.activity.getActivity(admin.id,)).total === before + 1, 'activity −1 on delete',);

    // Anonymous is refused unless the item allows it.
    let refused = false;
    try { await discussions.comments.create({ target, body: 'hi', guestName: 'G', }, { id: null, role: null, }, { ip: '10.0.0.9', },); } catch { refused = true; }
    assert(refused, 'anonymous refused when not allowed',);
    await threads.update('post', post.id, { allowAnonymous: true, },);
    const g = await discussions.comments.create({ target, body: 'guest', guestName: 'G', }, { id: null, role: null, }, { ip: '10.0.0.9', },);
    assert(g.status === 'pending' && g.author.name === 'G', 'anonymous held for approval',);
    const q = await discussions.moderation.list({}, viewer,);
    assert(q.items.some((i,) => i.id === g.id && i.target?.url.startsWith('/posts/',),), 'moderation queue lists it with its target',);
    await discussions.moderation.act(g.id, 'approve', viewer,);

    // Clean up.
    await query(`DELETE FROM comments WHERE target_type = 'post' AND target_id = $1`, [post.id,],);
    await query(`DELETE FROM comment_threads WHERE target_id = $1`, [post.id,],);
    await discussions.activity.reconcile();
    assert((await discussions.activity.getActivity(admin.id,)).total === before, 'reconcile restores counters',);
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
