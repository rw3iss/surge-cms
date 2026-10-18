/**
 * Per-block HTML-editor heights in localStorage (`sitesurge.editor.blockHeights`),
 * kept as a bounded LRU.
 *
 * One entry was added per HTML block ever opened and none were ever removed;
 * the key shares the origin's quota with the SDK's localStorage SWR cache, so
 * a full quota starts failing cache writes. Entries now carry a last-used time
 * (`{ h, t }`) and the oldest are dropped past `MAX_ENTRIES`. Legacy bare
 * numbers still read.
 */
export const STORAGE_KEY = 'sitesurge.editor.blockHeights';
export const MAX_ENTRIES = 200;

type Entry = number | { h: number; t: number; };
type Bag = Record<string, Entry>;

const heightOf = (e: Entry | undefined,): number | null =>
    typeof e === 'number' ? e : (e && typeof e.h === 'number' ? e.h : null);
const timeOf = (e: Entry,): number => (typeof e === 'number' ? 0 : e.t || 0);

/** Pure: the bag after recording `id` → `height` at `now`, pruned to `max`. */
export function withHeight(bag: Bag, id: string, height: number, now: number, max = MAX_ENTRIES,): Bag {
    const next: Bag = { ...bag, [id]: { h: height, t: now, }, };
    const keys = Object.keys(next,);
    if (keys.length <= max) return next;
    const oldest = keys.sort((a, b,) => timeOf(next[a]!,) - timeOf(next[b]!,)).slice(0, keys.length - max,);
    for (const k of oldest) delete next[k];
    return next;
}

function read(storage: Storage,): Bag {
    try {
        const raw = storage.getItem(STORAGE_KEY,);
        return raw ? (JSON.parse(raw,) as Bag) : {};
    } catch {
        return {};
    }
}

export function readStoredHeight(blockId: string, storage: Storage = localStorage,): number | null {
    return heightOf(read(storage,)[blockId],);
}

export function writeStoredHeight(blockId: string, height: number, storage: Storage = localStorage,): void {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(withHeight(read(storage,), blockId, height, Date.now(),),),);
    } catch {
        // ignore quota errors — height is a UI affordance, not data.
    }
}
