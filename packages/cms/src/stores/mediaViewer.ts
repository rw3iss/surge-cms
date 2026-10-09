/**
 * App-wide media lightbox. `openMediaViewer(urlOrMedia)` shows the shared
 * `MediaViewerModal` for an assigned image/video — a stored URL is looked up
 * in the library first (title, size, encoded-video player), and still shows
 * when it is not in the library. Rendered once by `MediaViewerHost`
 * (mounted in AdminLayout).
 */
import type { Media, } from '@sitesurge/types';
import { createSignal, } from 'solid-js';

/** A URL, a media record (or part of one with `url`), or `{ id }` for a library item. */
export type MediaViewerTarget = string | (Partial<Media> & ({ url: string; } | { id: string; }));

const [target, setTarget,] = createSignal<MediaViewerTarget | null>(null,);

export const mediaViewerTarget = target;

export function openMediaViewer(t: MediaViewerTarget | null | undefined,): void {
    if (!t || (typeof t === 'string' && !t.trim())) return;
    setTarget(() => t,);
}

export function closeMediaViewer(): void {
    setTarget(null,);
}

/**
 * Props that make an assigned thumbnail open the lightbox: click / Enter /
 * Space, focusable, "View full size" tooltip. Add class `media-viewable`
 * alongside (zoom-in cursor). Takes a getter so the CURRENT value opens.
 */
export function viewMediaProps(get: () => MediaViewerTarget | null | undefined,) {
    return {
        role: 'button',
        tabindex: 0,
        title: 'View full size',
        onClick: (e: MouseEvent,) => {
            e.stopPropagation();
            openMediaViewer(get(),);
        },
        onKeyDown: (e: KeyboardEvent,) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                openMediaViewer(get(),);
            }
        },
    } as const;
}
