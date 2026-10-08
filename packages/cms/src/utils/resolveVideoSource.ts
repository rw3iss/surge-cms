/**
 * Decide how a video source should be played.
 *
 * - `hls`   — an HLS master playlist (`.m3u8`) or an encoded media row
 *             (`media.video` present); play with VideoPlayer's `hlsSrc`.
 * - `file`  — a plain file (MP4/WebM/…); play with VideoPlayer + the MIME.
 * - `embed` — a YouTube/Vimeo page or embed URL; render an iframe.
 */

export interface VideoSourceInput {
    id?: string;
    url: string;
    mimeType?: string | null;
    status?: string | null;
    video?: unknown;
}

export interface ResolvedVideoSource {
    kind: 'hls' | 'file' | 'embed';
    src: string;
    /** MIME for `file` sources. */
    type?: string;
    poster?: string;
}

export const HLS_MIME = 'application/vnd.apple.mpegurl';

const EXT_MIME: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    ogg: 'video/ogg',
    m3u8: HLS_MIME,
};

/** File extension of a URL, ignoring the query string and fragment. */
function extOf(url: string,): string {
    const path = url.split(/[?#]/,)[0] ?? '';
    const dot = path.lastIndexOf('.',);
    return dot >= 0 ? path.slice(dot + 1,).toLowerCase() : '';
}

/** MIME type of a video URL by extension; `video/mp4` when unknown. */
export function videoMimeFromUrl(url: string,): string {
    return EXT_MIME[extOf(url,)] ?? 'video/mp4';
}

export function isHlsUrl(url: string | null | undefined,): boolean {
    return Boolean(url,) && extOf(url!,) === 'm3u8';
}

/** YouTube / Vimeo page URL → its embeddable player URL, else null. */
export function toEmbedUrl(url: string,): string | null {
    let u: URL;
    try {
        u = new URL(url,);
    } catch {
        return null;
    }
    const host = u.hostname.replace(/^www\.|^m\./, '',);
    if (host === 'youtu.be') {
        const id = u.pathname.slice(1,).split('/',)[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname.startsWith('/embed/',)) return url;
        const id = u.searchParams.get('v',)
            || (u.pathname.match(/^\/(?:shorts|live)\/([^/]+)/,)?.[1] ?? null);
        return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'player.vimeo.com') return url;
    if (host === 'vimeo.com') {
        const id = u.pathname.match(/^\/(\d+)/,)?.[1];
        return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    return null;
}

function posterOf(media: VideoSourceInput,): string | undefined {
    return (media.video as { posterUrl?: string | null; } | undefined)?.posterUrl ?? undefined;
}

export function resolveVideoSource(media: VideoSourceInput,): ResolvedVideoSource {
    const url = media.url || '';
    const embed = toEmbedUrl(url,);
    if (embed) return { kind: 'embed', src: embed, };
    if (isHlsUrl(url,) || media.mimeType === HLS_MIME) {
        return { kind: 'hls', src: url, type: HLS_MIME, poster: posterOf(media,), };
    }
    // An encoded media row: its `url` is the master playlist; fall back to the
    // API master path when it is not (a row from before the encode finished).
    if (media.video) {
        const poster = posterOf(media,);
        const src = media.id ? `/api/v1/video/${media.id}/master.m3u8` : url;
        return { kind: 'hls', src, type: HLS_MIME, poster, };
    }
    return { kind: 'file', src: url, type: media.mimeType || videoMimeFromUrl(url,), };
}
