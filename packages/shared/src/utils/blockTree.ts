import type { Block, } from '../types/content';

/**
 * Assemble a flat block list (with `parentBlockId`) into a tree of
 * top-level blocks, each with `children` populated recursively.
 *
 * - Input order within each parent is preserved (callers should sort by
 *   `order` before passing in; SQL already does this).
 * - Orphan children (parent missing or filtered out) are silently dropped.
 *   This is the right behavior for `visibleOnly = true` on the renderer
 *   side: a hidden parent hides its subtree.
 */
export function buildBlockTree(blocks: Block[],): Block[] {
    if (blocks.length === 0) return [];

    // Clone shallowly so we don't mutate caller's array; assign children.
    const byId = new Map<string, Block>();
    for (const b of blocks) {
        byId.set(b.id, { ...b, children: [], },);
    }

    const roots: Block[] = [];
    for (const b of blocks) {
        const node = byId.get(b.id,)!;
        if (b.parentBlockId == null) {
            roots.push(node,);
        } else {
            const parent = byId.get(b.parentBlockId,);
            if (parent) {
                parent.children!.push(node,);
            }
            // else: orphan — drop silently.
        }
    }

    return roots;
}
