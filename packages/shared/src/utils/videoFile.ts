/**
 * Is a file a video the encoder should take? Browsers report an EMPTY type for
 * some containers (`.mkv`, sometimes `.mov`/`.avi`) and multer then says
 * `application/octet-stream`, so the MIME type alone lets those slip through
 * as plain files that are never encoded. The extension backs it up.
 */
const VIDEO_EXT_MIME: Record<string, string> = {
    mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', mpeg: 'video/mpeg', mpg: 'video/mpeg',
    '3gp': 'video/3gpp', '3g2': 'video/3gpp2', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t', ogv: 'video/ogg',
};

/** The file's video MIME type (its own when `video/*`, else from the extension), or null when not a video. */
export function videoMimeFor(name: string | null | undefined, mime: string | null | undefined,): string | null {
    if (mime && /^video\//i.test(mime,)) return mime;
    const ext = (name ?? '').split(/[?#]/,)[0].split('.',).pop()?.toLowerCase() ?? '';
    // A generic/empty type only — a real non-video type (image/*, audio/*) wins.
    if (mime && !/^(application\/octet-stream|binary\/octet-stream)?$/i.test(mime,)) return null;
    return VIDEO_EXT_MIME[ext] ?? null;
}

export const isVideoFile = (name: string | null | undefined, mime: string | null | undefined,): boolean =>
    videoMimeFor(name, mime,) !== null;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** A library video's file/stream URL: `/api/v1/video/<id>/…` (the API) or `/video/<id>/…` (the storage/CDN layout). */
const LIBRARY_VIDEO_PATH = new RegExp(`^/(?:api/v1/)?video/(${UUID})(?:/|$)`, 'i',);

/** The site page for a library video — `/watch/<mediaId>` (the SPA player page). */
export const watchPath = (mediaId: string,): string => `/watch/${encodeURIComponent(mediaId,)}`;

/**
 * The library video id behind a media URL, or null.
 *
 * Matches the API's direct link (`/api/v1/video/<id>/file`, `…/master.m3u8`)
 * and the storage layout on the CDN (`https://cdn…/video/<id>/<encode>/…/1080p.mp4`),
 * on any host. Used so a link never sends a reader to a raw file.
 */
export function libraryVideoIdFromUrl(url: string | null | undefined,): string | null {
    if (!url) return null;
    let path = url.trim();
    const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/i.exec(path,);
    if (abs) path = abs[1] ?? '/';
    else path = path.split(/[?#]/,)[0];
    return LIBRARY_VIDEO_PATH.exec(path,)?.[1] ?? null;
}

/**
 * A link a reader may follow: a library video's file/CDN URL becomes its watch
 * page (`/watch/<id>`, site-relative); anything else is returned unchanged.
 */
export function siteMediaHref(url: string,): string {
    const id = libraryVideoIdFromUrl(url,);
    return id ? watchPath(id,) : url;
}
