/**
 * Keep the edit panel's block reference valid for the panel's whole life.
 *
 * The panel is mounted inside a `<Show keyed>` on the selected block id. When
 * the selection clears (X, Escape, deleting the block) the lookup returns
 * `null` BEFORE the panel is disposed — and its cleanups still read
 * `props.block.id`. A throw there aborts Solid's disposal half-way, which
 * leaves the panel on screen and every later selection dead.
 *
 * `stableSelection(id, lookup)` returns an accessor that yields the live block
 * while it exists and otherwise the LAST one seen for that id, so it never
 * returns null once it has resolved a block.
 */
export function stableSelection<T extends { id: string; }>(
    id: string,
    lookup: (id: string,) => T | null | undefined,
): () => T {
    const first = lookup(id,);
    let last: T | undefined = first && first.id === id ? first : undefined;
    return () => {
        const live = lookup(id,);
        if (live && live.id === id) last = live;
        if (!last) throw new Error(`stableSelection: block ${id} was never resolved`,);
        return last;
    };
}
