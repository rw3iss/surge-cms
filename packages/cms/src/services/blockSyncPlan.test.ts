/**
 * These pin the two ways a page save used to leave the stored block order
 * disagreeing with the editor — both of which shipped, and both of which are
 * invisible in the editor because the editor is working from the tree it just
 * rebuilt, not from what the database holds.
 *
 * The real report: a group block was pasted above another one on the homepage;
 * the editor showed the new order, the public site showed the old one, and
 * re-saving never fixed it. Two top-level blocks were sitting at order 2.
 */
import { describe, expect, it, } from 'vitest';
import { planBlockSync, } from './blockSyncPlan';
import type { BlockData, } from '../components/admin/blocks/ContentBlock';

/** A block, with `sort_order` meaning "what the row currently says". */
function blk(id: string, storedOrder: number, parent: string | null = null, data: Record<string, unknown> = {},): BlockData {
    return {
        id,
        type: 'html',
        parentBlockId: parent,
        sort_order: storedOrder,
        data: { title: '', content: '', ...data, },
    } as unknown as BlockData;
}

/** Stands in for blockDataToPageBlock: identity that captures what matters. */
const serialize = (b: BlockData, order: number,) => ({
    type: b.type,
    parentBlockId: b.parentBlockId ?? null,
    content: (b.data as { content?: unknown; }).content,
    order,
});

const ids = (p: { writes: Array<{ id: string; order: number; }>; },) =>
    p.writes.map(w => `${w.id}@${w.order}`).sort();

describe('planBlockSync', () => {
    it('writes nothing when the tree and the stored orders already agree', () => {
        const tree = [blk('a', 0,), blk('b', 1,), blk('c', 2,),];
        const plan = planBlockSync({
            current: tree, saved: tree, origIds: new Set(['a', 'b', 'c',],), serialize,
        },);
        expect(plan.writes,).toEqual([],);
        expect(plan.reorders,).toEqual([],);
        expect(plan.deletes,).toEqual([],);
    },);

    it('rewrites a block whose stored order drifted, even though nothing moved', () => {
        // THE HOMEPAGE BUG. The sequence a,b,c is identical in both trees, but
        // the row for `c` says 1 — a duplicate left by an earlier bad write.
        // Deriving the "saved" order from the array index would compare 2 to 2
        // and skip it forever, leaving two rows at order 1.
        const current = [blk('a', 0,), blk('b', 1,), blk('c', 2,),];
        const saved = [blk('a', 0,), blk('b', 1,), blk('c', 1,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['a', 'b', 'c',],), serialize,
        },);
        expect(ids(plan,),).toEqual(['c@2',],);
    },);

    it('renumbers the siblings an inserted block pushed down', () => {
        // Paste `x` between a and b. The EXISTING rows keep their relative
        // sequence (a,b,c), so a reorder pass that ignored new blocks saw
        // "unchanged" and never renumbered b and c — which then collided with x.
        const saved = [blk('a', 0,), blk('b', 1,), blk('c', 2,),];
        const current = [blk('a', 0,), blk('x', 0,), blk('b', 1,), blk('c', 2,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['a', 'b', 'c',],), serialize,
        },);

        expect(plan.reorders,).toEqual([
            { parentBlockId: null, blockIds: ['a', 'x', 'b', 'c',], },
        ],);
        // x is new; b and c shifted to 2 and 3.
        expect(ids(plan,),).toEqual(['b@2', 'c@3', 'x@1',],);
    },);

    it('handles a replace-paste: old row deleted, clone takes its slot', () => {
        const saved = [blk('a', 0,), blk('old', 1,), blk('c', 2,),];
        const current = [blk('a', 0,), blk('new', 1,), blk('c', 2,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['a', 'old', 'c',],), serialize,
        },);
        expect(plan.deletes,).toEqual(['old',],);
        expect(ids(plan,),).toEqual(['new@1',],);
        // The sequence changed (old -> new), so the group is renumbered.
        expect(plan.reorders,).toEqual([
            { parentBlockId: null, blockIds: ['a', 'new', 'c',], },
        ],);
    },);

    it('scopes order to each parent, so nesting does not renumber across groups', () => {
        const tree = [
            blk('g', 0,),
            blk('g1', 0, 'g',),
            blk('g2', 1, 'g',),
            blk('after', 1,),
        ];
        const plan = planBlockSync({
            current: tree, saved: tree, origIds: new Set(['g', 'g1', 'g2', 'after',],), serialize,
        },);
        expect(plan.writes,).toEqual([],);
    },);

    it('renumbers a nested group without touching the top level', () => {
        const saved = [blk('g', 0,), blk('g1', 0, 'g',), blk('g2', 1, 'g',), blk('t', 1,),];
        const current = [blk('g', 0,), blk('g2', 1, 'g',), blk('g1', 0, 'g',), blk('t', 1,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['g', 'g1', 'g2', 't',],), serialize,
        },);
        expect(plan.reorders,).toEqual([
            { parentBlockId: 'g', blockIds: ['g2', 'g1',], },
        ],);
        expect(ids(plan,),).toEqual(['g1@1', 'g2@0',],);
    },);

    it('moves a block between parents', () => {
        const saved = [blk('g', 0,), blk('child', 0, 'g',), blk('t', 1,),];
        const current = [blk('g', 0,), blk('t', 1,), blk('child', 0,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['g', 'child', 't',],), serialize,
        },);
        // Reparented AND reordered: it must be written, not skipped.
        expect(plan.writes.some(w => w.id === 'child',),).toBe(true,);
    },);

    it('marks a content edit dirty even when the order is untouched', () => {
        const saved = [blk('a', 0,), blk('b', 1, null, { content: 'old', },),];
        const current = [blk('a', 0,), blk('b', 1, null, { content: 'new', },),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['a', 'b',],), serialize,
        },);
        expect(ids(plan,),).toEqual(['b@1',],);
    },);

    it('does not reorder a group that has only one child', () => {
        const saved = [blk('g', 0,),];
        const current = [blk('g', 0,), blk('only', 0, 'g',),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['g',],), serialize,
        },);
        expect(plan.reorders,).toEqual([],);
        expect(ids(plan,),).toEqual(['only@0',],);
    },);

    it('deletes rows that left the tree, including a whole removed subtree', () => {
        const saved = [blk('g', 0,), blk('g1', 0, 'g',), blk('keep', 1,),];
        const current = [blk('keep', 0,),];
        const plan = planBlockSync({
            current, saved, origIds: new Set(['g', 'g1', 'keep',],), serialize,
        },);
        expect(plan.deletes.sort(),).toEqual(['g', 'g1',],);
        expect(ids(plan,),).toEqual(['keep@0',],);
    },);

    it('repairs stored orders that duplicate or skip, writing only what is wrong', () => {
        // Stored: a=0, b=2, c=2 (duplicate), d=7 (gap). Target indices are
        // 0,1,2,3. Only the rows whose stored value differs are written —
        // `a` is already 0 and `c` is already 2, so they are left alone. The
        // end state is still the contiguous run, which is the point: the plan
        // repairs the sequence without rewriting every row on every save.
        const tree = [blk('a', 0,), blk('b', 2,), blk('c', 2,), blk('d', 7,),];
        const plan = planBlockSync({
            current: tree, saved: tree, origIds: new Set(['a', 'b', 'c', 'd',],), serialize,
        },);
        expect(ids(plan,),).toEqual(['b@1', 'd@3',],);

        // Applying the plan over the stored values yields 0,1,2,3 — no
        // duplicate, no gap.
        const applied = new Map(tree.map(b => [b.id, b.sort_order ?? 0,] as const),);
        for (const w of plan.writes) applied.set(w.id, w.order,);
        expect([...applied.values(),].sort((x, y,) => x - y),).toEqual([0, 1, 2, 3,],);
    },);
},);
