import { describe, expect, it, vi, } from 'vitest';
import { buildWikiTree, wikiPagePath, } from '@sitesurge/types';

vi.mock('../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);
const { canView, excerptOf, } = await import('./wiki');

function page(over: Record<string, unknown> = {},): any {
    return {
        id: 'p1', title: 'Page', slug: null, content: '', tags: [], categories: [],
        parentId: null, viewRoles: [], status: 'published', position: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        ...over,
    };
}

describe('canView', () => {
    it('empty viewRoles means everyone, including anonymous', () => {
        // A wiki private by accident is worse than one public on purpose.
        expect(canView(page(), { role: 'anonymous', },),).toBe(true,);
        expect(canView(page(), {},),).toBe(true,);
    },);

    it('restricts to the listed roles', () => {
        const p = page({ viewRoles: ['member',], },);
        expect(canView(p, { role: 'member', },),).toBe(true,);
        expect(canView(p, { role: 'anonymous', },),).toBe(false,);
    },);

    it('lets staff view a restricted page', () => {
        const p = page({ viewRoles: ['member',], },);
        expect(canView(p, { role: 'editor', },),).toBe(true,);
        expect(canView(p, { role: 'admin', },),).toBe(true,);
    },);

    it('hides a draft from everyone but staff', () => {
        const p = page({ status: 'draft', },);
        expect(canView(p, { role: 'anonymous', },),).toBe(false,);
        expect(canView(p, { role: 'member', },),).toBe(false,);
        expect(canView(p, { role: 'editor', },),).toBe(true,);
    },);

    it('a draft stays hidden even when its viewRoles are open', () => {
        // Status is the stronger gate: publishing is a separate decision from
        // who may read once published.
        expect(canView(page({ status: 'draft', viewRoles: [], },), { role: 'member', },),).toBe(false,);
    },);
},);

describe('buildWikiTree', () => {
    it('nests children under parents', () => {
        const tree = buildWikiTree([
            page({ id: 'a', title: 'A', },),
            page({ id: 'b', title: 'B', parentId: 'a', },),
            page({ id: 'c', title: 'C', parentId: 'b', },),
        ],);
        expect(tree.length,).toBe(1,);
        expect(tree[0].children[0].id,).toBe('b',);
        expect(tree[0].children[0].children[0].id,).toBe('c',);
    },);

    it('promotes a child whose parent is missing to a root', () => {
        // Happens when a parent is filtered out by permissions — the child must
        // still be reachable rather than vanishing from the tree.
        const tree = buildWikiTree([page({ id: 'b', parentId: 'gone', },),],);
        expect(tree.length,).toBe(1,);
        expect(tree[0].id,).toBe('b',);
    },);

    it('orders by position then title', () => {
        const tree = buildWikiTree([
            page({ id: '1', title: 'Zebra', position: 0, },),
            page({ id: '2', title: 'Apple', position: 0, },),
            page({ id: '3', title: 'First', position: -1, },),
        ],);
        expect(tree.map((n,) => n.title),).toEqual(['First', 'Apple', 'Zebra',],);
    },);

    it('returns an empty tree for no pages', () => {
        expect(buildWikiTree([],),).toEqual([],);
    },);
},);

describe('wikiPagePath', () => {
    it('prefers the slug', () => {
        expect(wikiPagePath({ id: 'abc', slug: 'getting-started', },),).toBe('/wiki/getting-started',);
    },);

    it('falls back to the id when there is no slug', () => {
        expect(wikiPagePath({ id: 'abc', slug: null, },),).toBe('/wiki/abc',);
        expect(wikiPagePath({ id: 'abc', slug: '', },),).toBe('/wiki/abc',);
    },);
},);

describe('excerptOf', () => {
    it('strips markdown down to plain text', () => {
        expect(excerptOf('## Title\n\nSome **bold** text.',),).toBe('Title Some bold text.',);
    },);

    it('truncates with an ellipsis', () => {
        expect(excerptOf('a'.repeat(300,), 20,),).toHaveLength(20,);
    },);
},);
