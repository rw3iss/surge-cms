/**
 * Local smoke test for discussion DISCOVERY (latest / hot / top, template
 * functions, read-only entity types). Needs a dev DB with the Comments feature
 * on, a published public post and an admin.
 * Usage: npx tsx scripts/smoke-discovery.ts
 */
import { query as dbQuery, closePool, } from '../src/db';
import * as discussions from '../src/services/discussions';
import { query, } from '../src/services/discussions/query';
import * as threads from '../src/services/comments/threads';
import { resolveContentForSsr, } from '../src/services/ssr/templateRuntime';
import { resolveMailTemplate, } from '../src/services/mail/templateRuntime';
import { seedCoreEntityTypes, } from '../src/entities/coreDescriptors';
import * as entities from '../src/services/entities';
import { cache, } from '../src/services/cache';

const assert = (c: unknown, m: string,) => { if (!c) throw new Error(`FAIL: ${m}`,); console.log(`ok  ${m}`,); };
const ANON = { id: null, role: null, };

async function main() {
    const admin = (await dbQuery<{ id: string; role: string; }>(`SELECT id, role FROM users WHERE role IN ('admin','sysadmin') LIMIT 1`,)).rows[0];
    const post = (await dbQuery<{ id: string; title: string; }>(
        `SELECT id, title FROM posts WHERE status = 'published' AND is_private = false AND required_tier_id IS NULL LIMIT 1`,)).rows[0];
    const viewer = { id: admin.id, role: admin.role, };
    const target = `post:${post.id}` as const;
    await threads.update('post', post.id, { enabled: true, },);
    await cache.invalidateDiscussionFeedCache();

    const a = await discussions.comments.create({ target, body: 'Discovery smoke **A**', }, viewer,);
    const b = await discussions.comments.create({ target, body: 'Discovery smoke B (reacted)', }, viewer,);
    await discussions.moderation.react(b.id, '👍', viewer,);
    await discussions.comments.create({ target, body: 'reply to B', parentId: b.id, }, viewer,);

    const latest = await query({ kind: 'comment', sort: 'latest', limit: 5, }, ANON,);
    assert(latest.items[0]?.kind === 'comment' && latest.items[0].excerpt === 'reply to B', 'latest: newest first, plain-text excerpt',);
    const first = latest.items.find((i,) => i.id === a.id,);
    assert(first && first.kind === 'comment' && first.url.endsWith(`#comment-${a.id}`,) && first.target?.title === post.title, 'items carry target + url',);

    const hot = await query({ kind: 'comment', sort: 'hot', limit: 5, }, ANON,);
    assert(hot.items[0]?.id === b.id && hot.items[0].score > 0, 'hot: reacted + replied comment ranks first',);
    const top = await query({ kind: 'comment', sort: 'top', includeReplies: false, limit: 5, }, ANON,);
    assert(top.items.every((i,) => i.kind === 'comment' && !i.parentId,) && top.items[0]?.id === b.id, 'top: no replies when includeReplies=false',);

    // Anonymous result cached; a new comment drops it (event listener).
    const cached = await query({ kind: 'comment', sort: 'latest', limit: 5, }, ANON,);
    assert(cached.items.length === latest.items.length, 'anonymous result served (cache)',);
    const c = await discussions.comments.create({ target, body: 'cache buster', }, viewer,);
    await new Promise((r,) => setTimeout(r, 300,),);
    const fresh = await query({ kind: 'comment', sort: 'latest', limit: 5, }, ANON,);
    assert(fresh.items[0]?.id === c.id, 'cache dropped on a new comment',);

    // Commenting off → the post's comments still read (it is the item's access, not the switch).
    // A gated/unpublished target is excluded: flip the post to draft briefly.
    await dbQuery(`UPDATE posts SET status = 'draft' WHERE id = $1`, [post.id,],);
    await cache.invalidateDiscussionFeedCache();
    const hidden = await query({ kind: 'comment', limit: 10, }, ANON,);
    assert(!hidden.items.some((i,) => i.kind === 'comment' && i.targetId === post.id,), 'comments on an unpublished post are excluded for anonymous',);
    const staff = await query({ kind: 'comment', limit: 10, }, viewer,);
    assert(staff.items.some((i,) => i.kind === 'comment' && i.targetId === post.id,), '…but staff still see them',);
    await dbQuery(`UPDATE posts SET status = 'published' WHERE id = $1`, [post.id,],);
    await cache.invalidateDiscussionFeedCache();

    // Template functions (SSR + email).
    const ssr = await resolveContentForSsr(`{{ for latestComments(2) as c }}[{{ c.excerpt }}]{{ endfor }}|{{ commentCount('${post.id}') }}|{{ hotComments(1, window='7d') }}`,);
    assert(ssr.includes('[cache buster]',) && /\|\d+\|/.test(ssr,) && ssr.includes('discussion-list',), `SSR functions: ${ssr.slice(0, 120,)}…`,);
    const mail = await resolveMailTemplate(`{{ latestComments(1) }}`, {},);
    assert(mail.includes('href="http',) || mail.includes('<li>',), 'mail renders a linked list',);

    // Entity types.
    await seedCoreEntityTypes();
    const ent = await entities.list('comment', { filter: { sort: 'hot', }, limit: 3, },);
    assert(ent.items[0]?.id === b.id, 'entity list(comment, sort=hot) goes through the provider',);
    const one = await entities.get('comment', a.id,);
    assert(one.excerpt === 'Discovery smoke A', 'entity get(comment) by id',);

    await dbQuery(`DELETE FROM comments WHERE target_type = 'post' AND target_id = $1`, [post.id,],);
    await dbQuery(`DELETE FROM comment_threads WHERE target_id = $1`, [post.id,],);
    await discussions.activity.reconcile();
    await cache.invalidateDiscussionFeedCache();
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
