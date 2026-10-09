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
