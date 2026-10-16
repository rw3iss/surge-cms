/**
 * The "is this media still used?" confirmation shown before ANY media delete
 * (library, media edit modal, gallery item / collection removal with their
 * media). `confirmMediaDelete()` asks the server where the media is used
 * (`cms.media.usage`) and opens ONE dialog, rendered by
 * `MediaDeleteConfirmHost` (mounted in AdminLayout):
 *   - unused → the normal confirmation;
 *   - used   → "Used in N places:" with links, and a "Delete anyway" button.
 * Resolves `{ confirmed, force }` — send `force` with the delete so the server
 * (which refuses an in-use delete with 409 MEDIA_IN_USE) lets it through.
 */
import type { MediaUsage, MediaUsageKind, MediaUsageResponse, } from '@sitesurge/types';
import { createSignal, } from 'solid-js';
import { cms, } from '../services/cmsClient';

export interface MediaDeleteConfirmOptions {
    /** Media ids about to be deleted. */
    ids: string[];
    title?: string;
    /** Shown when nothing uses the media. */
    message?: string;
    /** Confirm label when nothing uses the media (default "Delete"). */
    confirmLabel?: string;
    /** Usages the caller removes in the same act (e.g. `gallery_item` when the
     *  gallery item is deleted with its media) — not counted. */
    ignoreKinds?: MediaUsageKind[];
}

export interface MediaDeleteConfirmRequest extends MediaDeleteConfirmOptions {
    /** Usages across all the ids, de-duplicated by record + field. */
    usages: MediaUsage[];
    resolve: (r: MediaDeleteConfirmResult,) => void;
}

export interface MediaDeleteConfirmResult {
    confirmed: boolean;
    /** True when the user confirmed over listed usages — send `force`. */
    force: boolean;
}

const [request, setRequest,] = createSignal<MediaDeleteConfirmRequest | null>(null,);
export const mediaDeleteRequest = request;

/** Flatten `{ mediaId: usage[] }` into one de-duplicated list. */
export function flattenUsage(usage: MediaUsageResponse, ignore: MediaUsageKind[] = [],): MediaUsage[] {
    const skip = new Set(ignore,);
    const seen = new Set<string>();
    const out: MediaUsage[] = [];
    for (const list of Object.values(usage,)) {
        for (const u of list) {
            if (skip.has(u.kind,)) continue;
            const key = `${u.kind}:${u.id}:${u.field}`;
            if (seen.has(key,)) continue;
            seen.add(key,);
            out.push(u,);
        }
    }
    return out;
}

/** Where these media are used (empty when the check fails — the server still guards). */
export async function fetchMediaUsage(ids: string[], ignoreKinds: MediaUsageKind[] = [],): Promise<MediaUsage[]> {
    const unique = [...new Set(ids.filter(Boolean,),),];
    if (!unique.length) return [];
    try {
        return flattenUsage(await cms.media.usage(unique,), ignoreKinds,);
    } catch {
        return [];
    }
}

export async function confirmMediaDelete(opts: MediaDeleteConfirmOptions,): Promise<MediaDeleteConfirmResult> {
    const usages = await fetchMediaUsage(opts.ids, opts.ignoreKinds,);
    return new Promise((resolve,) => {
        // A second request replaces an open one: the first resolves as cancelled.
        request()?.resolve({ confirmed: false, force: false, },);
        setRequest({
            ...opts, usages,
            resolve: (r,) => {
                setRequest(null,);
                resolve(r,);
            },
        },);
    },);
}

/** A 409 from a delete whose media became used after the check. */
export function isMediaInUseError(e: unknown,): boolean {
    return (e as { code?: string; } | null)?.code === 'MEDIA_IN_USE';
}
