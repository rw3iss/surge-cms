import type { Media, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { closeMediaViewer, mediaViewerTarget, type MediaViewerTarget, } from '../../../stores/mediaViewer';
import MediaViewerModal from './MediaViewerModal';

const EXT_MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', ico: 'image/x-icon', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf',
};

/** A record for a URL that is not in the library: type guessed from the extension. */
function bareMedia(url: string,): Media {
    const name = decodeURIComponent(url.split(/[?#]/,)[0].split('/',).pop() || url,);
    const ext = name.includes('.',) ? name.split('.',).pop()!.toLowerCase() : '';
    return { id: '', url, originalName: name, filename: name, mimeType: EXT_MIME[ext] ?? 'image/*', } as unknown as Media;
}

async function resolve(t: MediaViewerTarget,): Promise<Media> {
    const url = typeof t === 'string' ? t : (t.url ?? '');
    // A full library record (has id + mime type + url) needs no lookup.
    if (typeof t !== 'string' && t.id && t.mimeType && t.url) return t as Media;
    try {
        const found = typeof t !== 'string' && t.id
            ? await cms.media.getById(t.id,)
            : await cms.media.byUrl(url,);
        if (found) return found as unknown as Media;
    } catch { /* fall back to a bare record */ }
    if (!url) throw new Error('Media not found',);
    return { ...bareMedia(url,), ...(typeof t === 'string' ? {} : t), } as Media;
}

/** Renders the lightbox opened by `openMediaViewer()`. Mount once. */
const MediaViewerHost: Component = () => {
    const [media,] = createResource(mediaViewerTarget, resolve,);
    return (
        <Show when={mediaViewerTarget() && !media.loading && !media.error ? media.latest : undefined}>
            {(m,) => <MediaViewerModal media={m()} onClose={closeMediaViewer} />}
        </Show>
    );
};

export default MediaViewerHost;
