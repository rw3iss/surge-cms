/**
 * The Gallery admin DRAFT: every change (add, upload, remove, reorder, item
 * options) stays local until Publish, which sends one `PUT /gallery/admin/items`.
 *
 * Pure functions only (no Solid, no DOM beyond the File type) so the publish
 * body and the dirty check are unit-testable.
 */
import type { GalleryItem, GalleryItemPatch, GalleryMedia, GallerySyncBody, } from '@sitesurge/types';
import { galleryMediaType, } from '@sitesurge/types';

/** The editable options of an item (all fields always present in the draft). */
export interface DraftOptions {
    titleOverride: string;
    captionOverride: string;
    tags: string[];
    visibility: NonNullable<GalleryItemPatch['visibility']>;
    minTierId: string | null;
    comments: NonNullable<GalleryItemPatch['comments']>;
    anonymousComments: NonNullable<GalleryItemPatch['anonymousComments']>;
}

export interface DraftItem {
    /** Stable local key: the item id, `m:<mediaId>` (picked from the library) or `f:<n>` (a staged file). */
    key: string;
    /** Saved item id (absent for new ones). */
    id?: string;
    /** Library media picked for a NEW item. */
    mediaId?: string;
    /** A staged file, uploaded on Publish (never persisted to localStorage). */
    file?: File;
    /** Local preview (object URL) of a staged file. */
    previewUrl?: string;
    /** Media shown in the grid (null = deleted from the library). */
    media: GalleryMedia | null;
    options: DraftOptions;
    /** Marked for removal on Publish. */
    removed?: boolean;
    /** With `removed`: also delete the media from the library. */
    deleteMedia?: boolean;
    /** Saved-item extras (display only). */
    url?: string;
    commentCount?: number;
}

export const EMPTY_OPTIONS: DraftOptions = {
    titleOverride: '', captionOverride: '', tags: [], visibility: 'inherit', minTierId: null, comments: 'inherit', anonymousComments: 'inherit',
};

export function optionsOf(i: GalleryItem,): DraftOptions {
    return {
        titleOverride: i.titleOverride ?? '',
        captionOverride: i.captionOverride ?? '',
        tags: [...(i.tags ?? []),],
        visibility: i.visibility,
        minTierId: i.minTierId,
        comments: i.comments,
        anonymousComments: i.anonymousComments,
    };
}

/** Saved items → draft rows. */
export function draftFromItems(items: GalleryItem[],): DraftItem[] {
    return items.map((i,) => ({
        key: i.id, id: i.id, media: i.media, options: optionsOf(i,), url: i.url, commentCount: i.commentCount,
    }));
}

/** A library media record (as listed by the media picker) → the gallery media shape. */
export function mediaFromLibrary(m: {
    id: string; mimeType: string; url: string; thumbnailUrl?: string | null; title?: string | null; caption?: string | null;
    alt?: string | null; credits?: string | null; width?: number | null; height?: number | null; durationMs?: number | null;
    accessLevel?: 'public' | 'private'; status?: string; video?: { posterUrl?: string | null; } | null; originalName?: string | null;
},): GalleryMedia {
    return {
        id: m.id,
        type: galleryMediaType(m.mimeType,),
        mimeType: m.mimeType,
        url: m.url,
        thumbnailUrl: m.video?.posterUrl ?? m.thumbnailUrl ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        durationMs: m.durationMs ?? null,
        // Same fallback as the server (services/gallery/items nameOf): the file name without extension.
        title: m.title?.trim() || fileTitle(m.originalName,) || null,
        caption: m.caption ?? null,
        alt: m.alt ?? null,
        credits: m.credits ?? null,
        accessLevel: m.accessLevel ?? 'public',
        status: m.status ?? 'ready',
    };
}

/** Options → the patch sent for an item (empty overrides become null). */
export function patchOf(o: DraftOptions,): GalleryItemPatch {
    return {
        titleOverride: o.titleOverride.trim() || null,
        captionOverride: o.captionOverride.trim() || null,
        tags: o.tags,
        visibility: o.visibility,
        minTierId: o.visibility === 'tier' ? o.minTierId : null,
        comments: o.comments,
        anonymousComments: o.anonymousComments,
    };
}

/**
 * The publish body. `uploaded` maps a staged file's key → its new media id
 * (filled in after the uploads finish). A staged row without an uploaded id
 * is an error — the caller uploads first.
 */
export function buildPublishBody(draft: DraftItem[], uploaded: Map<string, string> = new Map(),): GallerySyncBody {
    const items: GallerySyncBody['items'] = [];
    for (const d of draft) {
        if (d.removed) continue;
        if (d.id) {
            items.push({ id: d.id, ...patchOf(d.options,), },);
            continue;
        }
        const mediaId = d.mediaId ?? uploaded.get(d.key,);
        if (!mediaId) throw new Error(`"${d.file?.name ?? d.key}" has not been uploaded.`,);
        items.push({ mediaId, ...patchOf(d.options,), },);
    }
    const remove = draft.filter((d,) => d.removed && d.id,).map((d,) => ({ id: d.id!, deleteMedia: Boolean(d.deleteMedia,), }));
    return remove.length ? { items, remove, } : { items, };
}

const sameOptions = (a: DraftOptions, b: DraftOptions,) => JSON.stringify(patchOf(a,),) === JSON.stringify(patchOf(b,),);

/** Does the draft differ from the saved items (adds, removals, order, options)? */
export function isDraftDirty(draft: DraftItem[], saved: GalleryItem[],): boolean {
    const live = draft.filter((d,) => !d.removed,);
    if (draft.some((d,) => d.removed && d.id,)) return true;
    if (live.some((d,) => !d.id,)) return true;
    if (live.length !== saved.length) return true;
    return live.some((d, i,) => d.id !== saved[i].id || !sameOptions(d.options, optionsOf(saved[i],),),);
}

/** Move the row at `from` to `to` (drag-and-drop), returning a new array. */
export function moveItem<T,>(list: T[], from: number, to: number,): T[] {
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
    const next = [...list,];
    const [x,] = next.splice(from, 1,);
    next.splice(to, 0, x,);
    return next;
}

/** Serialisable draft for localStorage — staged files cannot be persisted, so they are left out. */
export function persistableDraft(draft: DraftItem[],): DraftItem[] {
    return draft.filter((d,) => !d.file,).map(({ file: _f, previewUrl: _p, ...rest },) => rest);
}

/** `IMG_2034.jpeg` → `IMG 2034` (matches the server's fallback title). */
export function fileTitle(name: string | null | undefined,): string {
    return (name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '',).replace(/[_-]+/g, ' ',).trim();
}

/** Display title of a row: the override, else the media's title, else a name. */
export function displayTitle(d: DraftItem,): string {
    return d.options.titleOverride.trim() || d.media?.title?.trim() || fileTitle(d.file?.name,) || (d.media ? 'Untitled' : 'Media missing');
}
