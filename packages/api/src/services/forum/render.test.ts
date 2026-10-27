/** Forum block on the backend surfaces: SSR + email list HTML and the block registries. */
import { describe, expect, it, vi, } from 'vitest';
import { type ForumFeedThread, normalizeForumBlockSettings, } from '@sitesurge/types';

vi.mock('../../config', () => ({ config: { frontendUrl: 'https://site.test', }, }),);

import { forumJoinUrl, forumListHtml, } from './render';
import { FORUM_RESOLVED_KEY, } from './serverRender';
import { renderForumBlock, } from '../ssr/blocks/forum';
import { renderForum, } from '../mail/blocks/forum';

const item = (over: Partial<ForumFeedThread> = {},): ForumFeedThread => ({
    id: 't1', slug: 'hello', title: 'Hello <world>', url: '/forum/talk/hello', category: { id: 'c1', slug: 'talk', name: 'Talk', },
    author: { id: 'u1', name: 'Ann', handle: 'ann', avatarUrl: null, role: null, tierName: null, activityCount: 0, joinedAt: null, isGuest: false, },
    opening: null, excerpt: 'First post body', status: 'visible', pinned: false, locked: false, replyCount: 1, viewCount: 0, reactionCount: 0,
    lastReplyAt: null, lastReplyBy: null, createdAt: '2026-10-01T00:00:00Z', canReply: true, replyBlockedReason: null, ...over,
});

describe('forumListHtml', () => {
    it('lists escaped, linked titles with author, count and excerpt', () => {
        const html = forumListHtml([item(),], normalizeForumBlockSettings({ heading: 'Latest', },),);
        expect(html,).toContain('<h2>Latest</h2>',);
        expect(html,).toContain('<a href="/forum/talk/hello">Hello &lt;world&gt;</a>',);
        expect(html,).toContain('Ann · 1 reply',);
        expect(html,).toContain('First post body',);
        expect(html,).not.toContain('Join the discussion',);
    },);
    it('respects content = none and the excerpt length', () => {
        expect(forumListHtml([item(),], normalizeForumBlockSettings({ content: 'none', },),),).not.toContain('First post',);
        expect(forumListHtml([item({ excerpt: 'x'.repeat(100,), },),], normalizeForumBlockSettings({ excerptLength: 20, },),),).toContain(`${'x'.repeat(19,)}…`,);
    },);
    it('thread mode shows the one thread', () => {
        const html = forumListHtml([item(),], normalizeForumBlockSettings({ mode: 'thread', thread: 'hello', },),);
        expect(html,).toContain('forum-block-thread',);
        expect(html,).not.toContain('<ul',);
    },);
    it('empty: nothing, or the empty text', () => {
        expect(forumListHtml([], normalizeForumBlockSettings({},),),).toBe('',);
        expect(forumListHtml([], normalizeForumBlockSettings({ emptyText: 'No posts yet', },),),).toContain('No posts yet',);
    },);
    it('email: absolute links + "Join the discussion" to the first thread\'s category', () => {
        const html = forumListHtml([item(),], normalizeForumBlockSettings({},), { base: 'https://site.test', email: true, linkColor: '#123456', },);
        expect(html,).toContain('href="https://site.test/forum/talk/hello" style="color:#123456;"',);
        expect(html,).toContain('href="https://site.test/forum/talk"',);
        expect(html,).toContain('Join the discussion',);
        expect(forumJoinUrl([],),).toBe('/forum',);
    },);
},);

describe('block renderers', () => {
    const settings = { [FORUM_RESOLVED_KEY]: [item(),], };
    it('SSR wraps the stashed threads in a section', () => {
        expect(renderForumBlock({ type: 'forum', settings, },),).toContain('ssr-block--forum',);
        expect(renderForumBlock({ type: 'forum', settings: {}, },),).toBe('',);
    },);
    it('email renders absolute links from the site URL', () => {
        const out = renderForum({ id: 'b', blockType: 'forum', settings, style: {}, children: [], }, { siteUrl: 'https://site.test/', linkColor: '#000', textColor: '#111', } as never,);
        expect(String(out,),).toContain('https://site.test/forum/talk/hello',);
    },);
},);
