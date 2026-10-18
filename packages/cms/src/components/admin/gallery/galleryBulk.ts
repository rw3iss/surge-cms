/**
 * Gallery admin filter + bulk edits (F2) — pure helpers over the draft rows,
 * so the grid filter and every bulk action are unit-tested. Every bulk action
 * is a DRAFT edit (published with the rest, undone by Discard), moves included.
 */
import type { DraftItem, DraftOptions, } from './galleryDraft';
import { displayTitle, } from './galleryDraft';

export type GalleryTypeFilter = 'all' | 'image' | 'video';

const isVideo = (r: DraftItem,) => r.media?.type === 'video' || Boolean(r.file?.type.startsWith('video/',),);

/** Rows matching a title / tag / caption search and a media type. */
export function filterRows(rows: DraftItem[], text: string, type: GalleryTypeFilter,): DraftItem[] {
    const q = text.trim().toLowerCase();
    return rows.filter((r,) => {
        if (type === 'video' && !isVideo(r,)) return false;
        if (type === 'image' && isVideo(r,)) return false;
        if (!q) return true;
        const hay = [displayTitle(r,), r.options.captionOverride, ...r.options.tags, r.media?.title ?? '', r.file?.name ?? '',]
            .join(' ',).toLowerCase();
        return hay.includes(q,);
    },);
}

export type BulkAction =
    | { kind: 'move'; collectionId: string | null; }
    | { kind: 'visibility'; visibility: DraftOptions['visibility']; minTierId?: string | null; }
    | { kind: 'addTag'; tag: string; }
    | { kind: 'remove'; };

/**
 * The patch each selected row gets (by key). A row being removed is skipped by
 * every action but `remove`; a NEW row being removed just leaves the draft
 * (returned in `drop`).
 */
export function bulkPatches(rows: DraftItem[], keys: Set<string>, action: BulkAction,): { patches: Map<string, Partial<DraftItem>>; drop: string[]; } {
    const patches = new Map<string, Partial<DraftItem>>();
    const drop: string[] = [];
    for (const r of rows) {
        if (!keys.has(r.key,)) continue;
        if (action.kind === 'remove') {
            if (!r.id) drop.push(r.key,);
            else patches.set(r.key, { removed: true, deleteMedia: false, },);
            continue;
        }
        if (r.removed) continue;
        if (action.kind === 'move') {
            if ((r.collectionId ?? null) !== action.collectionId) patches.set(r.key, { collectionId: action.collectionId, },);
        } else if (action.kind === 'visibility') {
            const minTierId = action.visibility === 'tier' ? (action.minTierId ?? null) : null;
            patches.set(r.key, { options: { ...r.options, visibility: action.visibility, minTierId, }, },);
        } else {
            const tag = action.tag.trim().toLowerCase().slice(0, 40,);
            if (tag && !r.options.tags.includes(tag,)) patches.set(r.key, { options: { ...r.options, tags: [...r.options.tags, tag,], }, },);
        }
    }
    return { patches, drop, };
}
