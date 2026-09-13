import type { BlockData, } from '../components/admin/blocks/ContentBlock';

/**
 * Works out what a page save has to send for its block tree: which rows to
 * delete, which to write (and at what order), and which sibling groups to
 * renumber.
 *
 * Split out of PageEditor because the decisions are subtle, order-dependent and
 * exactly where this has gone wrong before — a pure function can be tested
 * against the failure cases instead of only being exercised by clicking around
 * the editor and hoping.
 *
 * TWO RULES CARRY THE WHOLE THING:
 *
 * 1. A block's target order is its INDEX AMONG ITS SIBLINGS in the current
 *    tree; a block is dirty when its payload differs from what the server
 *    HOLDS. Those are different sources — the first is derived, the second is
 *    the stored `sort_order`. Deriving both (which is what this used to do)
 *    compares a sequence against itself, so it can only see "did this block
 *    move relative to its siblings" and never "is the row still wrong". A page
 *    whose stored orders had drifted compared equal forever and could not be
 *    repaired by saving.
 *
 * 2. The reorder pass counts NEW blocks as part of the sequence. Excluding them
 *    means an insert never looks like a reorder — the existing rows keep their
 *    relative sequence when something is pasted between them — so the siblings
 *    the new block pushed down are never renumbered and end up sharing its
 *    order.
 */

export interface BlockSyncPlan {
    /** Rows that existed at load and are gone from the tree. */
    deletes: string[];
    /** Blocks to POST (new) or PUT (changed), in parents-before-children order. */
    writes: Array<{ id: string; order: number; isNew: boolean; }>;
    /** Sibling groups whose sequence changed, to renumber atomically. */
    reorders: Array<{ parentBlockId: string | null; blockIds: string[]; }>;
}

/** A block's index within its own parent's children. */
function orderIndex(list: BlockData[],): Map<string, number> {
    const byParent = new Map<string | null, number>();
    const byId = new Map<string, number>();
    for (const b of list) {
        const key = b.parentBlockId ?? null;
        const next = (byParent.get(key,) ?? -1) + 1;
        byParent.set(key, next,);
        byId.set(b.id, next,);
    }
    return byId;
}

/** Ids under each parent, in tree order. */
function seqByParent(list: BlockData[],): Map<string | null, string[]> {
    const m = new Map<string | null, string[]>();
    for (const b of list) {
        const key = b.parentBlockId ?? null;
        const bucket = m.get(key,) ?? m.set(key, [],).get(key,)!;
        bucket.push(b.id,);
    }
    return m;
}

export function planBlockSync(opts: {
    /** The tree as the editor now holds it, flattened parents-first. */
    current: BlockData[];
    /** The tree as last loaded/saved, carrying each row's stored sort_order. */
    saved: BlockData[];
    /** Ids that existed server-side at load. */
    origIds: Set<string>;
    /**
     * Serialize a block for comparison. Injected so this module stays free of
     * the wire format (and of the style-ref resolution that goes with it).
     */
    serialize: (block: BlockData, order: number,) => unknown;
},): BlockSyncPlan {
    const { current, saved, origIds, serialize, } = opts;

    const currentIds = new Set(current.map(b => b.id),);
    const deletes = [...origIds,].filter(id => !currentIds.has(id,));

    const orderById = orderIndex(current,);
    const savedById = new Map(saved.map(b => [b.id, b,] as const),);

    const writes: BlockSyncPlan['writes'] = [];
    for (const b of current) {
        const order = orderById.get(b.id,) ?? 0;
        if (!origIds.has(b.id,)) {
            writes.push({ id: b.id, order, isNew: true, },);
            continue;
        }
        const prev = savedById.get(b.id,);
        // `prev.sort_order` is what the ROW says, not where it sits in the
        // loaded array — see rule 1 above.
        const unchanged = prev !== undefined
            && JSON.stringify(serialize(b, order,),) === JSON.stringify(serialize(prev, prev.sort_order ?? 0,),);
        if (!unchanged) writes.push({ id: b.id, order, isNew: false, },);
    }

    const currentSeq = seqByParent(current,);
    const savedSeq = seqByParent(saved,);
    const reorders: BlockSyncPlan['reorders'] = [];
    for (const [parentBlockId, blockIds,] of currentSeq.entries()) {
        // A lone child has no sequence to fix; its order is written by the
        // normal write pass above.
        if (blockIds.length < 2) continue;
        const prev = savedSeq.get(parentBlockId,) ?? [];
        if (blockIds.join(',',) === prev.join(',',)) continue;
        reorders.push({ parentBlockId, blockIds, },);
    }

    return { deletes, writes, reorders, };
}
