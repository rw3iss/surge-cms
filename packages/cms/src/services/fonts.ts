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
import { cms, } from './cmsClient';

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
            const list = await cms.fonts.list();
            const data = Array.isArray(list,) ? (list as unknown as Font[]) : [];
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
    const fields: Record<string, string> = {};
    if (opts.customId) fields.customId = opts.customId;
    if (opts.familyName) fields.familyName = opts.familyName;

    // The client builds the multipart FormData internally and applies the
    // same cookie + CSRF transport the old hand-rolled fetch used.
    const created = await cms.fonts.upload(file, fields,);
    await reloadFonts();
    return created as unknown as Font;
}

export async function deleteFont(id: string,): Promise<void> {
    await cms.fonts.remove(id,);
    await reloadFonts();
}

// ─── @font-face injection (shared by admin surfaces) ───

/** Map a stored font format to a CSS `format()` hint. */
export function fontFormatHint(fmt: string,): string {
    switch (fmt) {
        case 'woff2': return 'woff2';
        case 'woff': return 'woff';
        case 'ttf': return 'truetype';
        case 'otf': return 'opentype';
        case 'eot': return 'embedded-opentype';
        default: return fmt;
    }
}

/** Build the @font-face CSS for a font list; each family is the font's
 *  `customId`, so anywhere can use `font-family: '<customId>'`. */
export function fontFaceCss(list: Font[],): string {
    return list.map(f =>
        `@font-face { font-family: '${f.customId}'; src: url('${f.url}') format('${fontFormatHint(f.format,)}'); font-display: swap; }`
    ,).join('\n',);
}

/** Inject (idempotent, single <style> tag) @font-face rules for the given
 *  fonts so the admin can render text in the real uploaded fonts. */
export function injectFontFaces(list: Font[],): void {
    if (typeof document === 'undefined') return;
    const tagId = 'sitesurge-font-faces';
    let tag = document.getElementById(tagId,) as HTMLStyleElement | null;
    if (!tag) {
        tag = document.createElement('style',);
        tag.id = tagId;
        document.head.appendChild(tag,);
    }
    tag.textContent = fontFaceCss(list,);
}

/** Load the font list and ensure its @font-face declarations are present in
 *  <head>. Call from any admin surface that previews fonts (FontSelect,
 *  AdminLayout). */
export async function ensureFontFaces(): Promise<Font[]> {
    const list = await loadFonts();
    injectFontFaces(list,);
    return list;
}
