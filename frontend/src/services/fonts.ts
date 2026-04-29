/**
 * Fonts service — typed client for the /fonts API.
 *
 * Mirrors the backend SDK's `cms.fonts` shape so admin code can call
 * `fonts.list()` / `fonts.upload(file, opts)` / `fonts.remove(id)`
 * without thinking about HTTP. A central `loadFonts()` plus a Solid
 * signal lets components subscribe to the live font list without
 * each one re-fetching.
 */
import { createSignal, } from 'solid-js';
import { api, } from './api';

export interface Font {
    id: string;
    customId: string;
    originalName: string;
    fileName: string;
    format: string;
    sizeBytes: number;
    familyName?: string | null;
    url: string;
    createdAt: string;
    updatedAt: string;
}

const [fonts, setFonts,] = createSignal<Font[]>([],);
let loadPromise: Promise<Font[]> | null = null;
let loaded = false;

export { fonts, };

/** Lazy-load the font list. Subsequent callers share the in-flight
 *  promise; once loaded, returns the cached signal value. */
export function loadFonts(forceRefresh = false,): Promise<Font[]> {
    if (loaded && !forceRefresh) return Promise.resolve(fonts(),);
    if (loadPromise && !forceRefresh) return loadPromise;
    loadPromise = (async () => {
        try {
            const res = await api.get<Font[]>('/fonts',);
            const data = res.success && Array.isArray((res as any).data,)
                ? (res as any).data as Font[]
                : [];
            setFonts(data,);
            loaded = true;
            return data;
        } catch {
            setFonts([],);
            loaded = true;
            return [];
        }
    })();
    return loadPromise;
}

/** Force-refresh after a write. */
export async function reloadFonts(): Promise<Font[]> {
    loadPromise = null;
    loaded = false;
    return loadFonts();
}

export interface UploadFontOptions {
    customId?: string;
    familyName?: string;
}

/** Upload a font file via FormData. Returns the new Font row on
 *  success, throws with a server-supplied message on failure. */
export async function uploadFont(file: File, opts: UploadFontOptions = {},): Promise<Font> {
    const formData = new FormData();
    formData.append('file', file,);
    if (opts.customId) formData.append('customId', opts.customId,);
    if (opts.familyName) formData.append('familyName', opts.familyName,);

    // Use fetch directly — the api wrapper wants JSON. Same auth
    // (cookies via credentials: 'include') and CSRF header pattern
    // that api.ts uses internally.
    const csrf = document.cookie.match(/csrf-token=([^;]+)/,)?.[1] ?? '';
    const response = await fetch('/api/v1/fonts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrf, },
        body: formData,
    },);
    const data = await response.json();
    if (!data.success) {
        throw new Error(data.error?.message || 'Upload failed',);
    }
    await reloadFonts();
    return data.data as Font;
}

export async function deleteFont(id: string,): Promise<void> {
    const res = await api.delete(`/fonts/${id}`,);
    if (!res.success) throw new Error((res as any).error?.message || 'Delete failed',);
    await reloadFonts();
}
