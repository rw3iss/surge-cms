/**
 * Revision snapshot internals.
 *
 * These two helpers are where a restore goes wrong silently rather than loudly:
 * bad ordering throws a foreign-key error that looks like a database problem,
 * and a hash that ignores real edits quietly stops recording history. Both are
 * pure, so they are testable without a database.
 */
import { describe, expect, it, } from 'vitest';
import { hashSnapshot, orderParentsFirst, type ContentSnapshot, } from './revisions';

const snap = (entity: Record<string, unknown>, blocks: Array<Record<string, unknown>>,): ContentSnapshot => ({
    v: 2,
    entity,
    blocks,
});

describe('orderParentsFirst', () => {
    it('puts a parent before its child', () => {
        const out = orderParentsFirst([
            { id: 'child', parentBlockId: 'root', },
            { id: 'root', parentBlockId: null, },
        ],);
        expect(out.map((b,) => b.id),).toEqual(['root', 'child',],);
    });

    it('orders three levels correctly, whatever the input order', () => {
        // The bug this guards: sorting by `parent_block_id NULLS FIRST` groups
        // roots first but then orders by a UUID, so a grandchild can precede
        // its own parent. Groups nest arbitrarily deep, so this must be a walk.
        const out = orderParentsFirst([
            { id: 'grandchild', parentBlockId: 'child', },
            { id: 'child', parentBlockId: 'root', },
            { id: 'root', parentBlockId: null, },
        ],);
        const pos = (id: string,) => out.findIndex((b,) => b.id === id);
        expect(pos('root',),).toBeLessThan(pos('child',),);
        expect(pos('child',),).toBeLessThan(pos('grandchild',),);
    });

    it('keeps every block', () => {
        const input = [
            { id: 'a', parentBlockId: null, },
            { id: 'b', parentBlockId: 'a', },
            { id: 'c', parentBlockId: 'a', },
            { id: 'd', parentBlockId: 'c', },
        ];
        expect(orderParentsFirst(input,).length,).toBe(4,);
    });

    it('de-parents a block whose parent is missing rather than dropping it', () => {
        const out = orderParentsFirst([
            { id: 'orphan', parentBlockId: 'gone', },
            { id: 'root', parentBlockId: null, },
        ],);
        expect(out.length,).toBe(2,);
        expect(out.find((b,) => b.id === 'orphan',)?.parentBlockId,).toBeNull();
    });

    it('does not hang on a parent cycle', () => {
        // A cycle should be impossible, but a naive walk would recurse forever
        // and take the whole restore — and the request thread — with it.
        const out = orderParentsFirst([
            { id: 'a', parentBlockId: 'b', },
            { id: 'b', parentBlockId: 'a', },
        ],);
        expect(out.length,).toBe(2,);
        expect(out.every((b,) => b.parentBlockId === null),).toBe(true,);
    });

    it('handles the snake_case column name too', () => {
        const out = orderParentsFirst([
            { id: 'child', parent_block_id: 'root', },
            { id: 'root', parent_block_id: null, },
        ],);
        expect(out.map((b,) => b.id),).toEqual(['root', 'child',],);
    });
});

describe('hashSnapshot', () => {
    it('is stable across block order', () => {
        const a = snap({ title: 'Home', }, [{ id: '1', }, { id: '2', },],);
        const b = snap({ title: 'Home', }, [{ id: '2', }, { id: '1', },],);
        expect(hashSnapshot(a,),).toBe(hashSnapshot(b,),);
    });

    it('is stable across object key order', () => {
        const a = snap({ title: 'Home', slug: 'home', }, [],);
        const b = snap({ slug: 'home', title: 'Home', }, [],);
        expect(hashSnapshot(a,),).toBe(hashSnapshot(b,),);
    });

    it('ignores updatedAt, so re-saving an unchanged page adds no revision', () => {
        const a = snap({ title: 'Home', updatedAt: '2026-09-01T00:00:00Z', }, [],);
        const b = snap({ title: 'Home', updatedAt: '2026-09-03T12:00:00Z', }, [],);
        expect(hashSnapshot(a,),).toBe(hashSnapshot(b,),);
    });

    it('ignores viewCount — a page being read is not a page being edited', () => {
        const a = snap({ title: 'Home', viewCount: 1, }, [],);
        const b = snap({ title: 'Home', viewCount: 999, }, [],);
        expect(hashSnapshot(a,),).toBe(hashSnapshot(b,),);
    });

    it('changes when a block is removed', () => {
        const before = snap({ title: 'Home', }, [{ id: '1', }, { id: '2', },],);
        const after = snap({ title: 'Home', }, [{ id: '1', },],);
        expect(hashSnapshot(before,),).not.toBe(hashSnapshot(after,),);
    });

    it('changes when a nested block setting changes', () => {
        const before = snap({ title: 'Home', }, [
            { id: '1', settings: { columns: 2, items: [{ url: 'a', },], }, },
        ],);
        const after = snap({ title: 'Home', }, [
            { id: '1', settings: { columns: 2, items: [{ url: 'b', },], }, },
        ],);
        expect(hashSnapshot(before,),).not.toBe(hashSnapshot(after,),);
    });

    it('changes when only a block style changes', () => {
        const before = snap({ title: 'Home', }, [{ id: '1', style: { width: '40%', }, },],);
        const after = snap({ title: 'Home', }, [{ id: '1', style: { width: '60%', }, },],);
        expect(hashSnapshot(before,),).not.toBe(hashSnapshot(after,),);
    });

    it('changes when only block order changes', () => {
        const before = snap({ title: 'Home', }, [{ id: '1', order: 0, }, { id: '2', order: 1, },],);
        const after = snap({ title: 'Home', }, [{ id: '1', order: 1, }, { id: '2', order: 0, },],);
        expect(hashSnapshot(before,),).not.toBe(hashSnapshot(after,),);
    });

    it('changes when a block is re-parented', () => {
        const before = snap({ title: 'Home', }, [{ id: '1', parentBlockId: null, },],);
        const after = snap({ title: 'Home', }, [{ id: '1', parentBlockId: 'g', },],);
        expect(hashSnapshot(before,),).not.toBe(hashSnapshot(after,),);
    });
});
