/**
 * Email output of the blocks that can read a template SLOT, given the data the
 * expansion pass (`expandDynamicBlocks`) stashed on their settings.
 */
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { type EmailRenderCtx, renderNode, } from './index';
import { renderPostList, } from './postList';

const CTX: EmailRenderCtx = {
    siteName: 'Test', siteUrl: 'https://test.example', palette: {}, fontFamily: 'Arial',
    textColor: '#111', bgColor: '#fff', linkColor: '#00e', typography: TYPOGRAPHY_DEFAULTS,
};

describe('post_list email with slot data', () => {
    it('renders the slot posts as rows linking to each post', () => {
        const html = String(renderPostList({
            id: 'p', blockType: 'post_list', style: {}, children: [],
            settings: { source: 'slot', slotId: 's', resolvedPosts: [{ slug: 'one', title: 'One & two', excerpt: 'Ex', },], },
        } as never, CTX,),);
        expect(html,).toContain('https://test.example/posts/one',);
        expect(html,).toContain('One &amp; two',);
        expect(html,).toContain('Ex',);
    },);
    it('an empty / unfilled slot renders NOTHING (not the "View latest posts" fallback)', () => {
        expect(renderPostList({ id: 'p', blockType: 'post_list', style: {}, children: [], settings: { source: 'slot', resolvedPosts: [], }, } as never, CTX,),).toBe('',);
    },);
    it('a normal Posts block keeps its fallback link', () => {
        const out = renderPostList({ id: 'p', blockType: 'post_list', children: [], style: {}, settings: {}, } as never, CTX,);
        expect((out as { content: string; }).content,).toContain('View latest posts',);
    },);
},);

describe('gallery email with slot data', () => {
    it('renders the items the slot resolved to', () => {
        const items = [{
            id: 'g1', mediaId: 'm1', title: 'First', caption: null, url: '/gallery/g1',
            media: { id: 'm1', type: 'image', mimeType: 'image/jpeg', url: 'https://cdn.example/a.jpg', thumbnailUrl: 'https://cdn.example/a-t.jpg', width: 800, height: 600, accessLevel: 'public', status: 'ready', },
        },];
        const html = renderNode({
            id: 'g', blockType: 'gallery', children: [], style: {},
            settings: { source: 'slot', slotId: 'photos', __galleryItems: items, desktop: { layout: 'grid', columns: 2, }, },
        } as never, CTX,);
        expect(html,).toMatch(/cdn\.example\/a(-t)?\.jpg/,);
        expect(html,).toContain('/gallery/g1',);
    },);
},);
