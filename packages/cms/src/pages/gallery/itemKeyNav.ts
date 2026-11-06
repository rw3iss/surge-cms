/**
 * Arrow-key previous / next on the gallery item page. Pure so it can be
 * tested without a DOM: the caller passes the event's fields + whether the
 * target is a place where arrows already mean something.
 */
export interface NavKeyEvent {
    key: string;
    defaultPrevented?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

/** Elements whose own arrow-key behavior must win (text, sliders, the video player). */
export const ARROW_OWNERS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="menu"], [role="listbox"], video, iframe, .vp, .media-video';

export function galleryNavKey(e: NavKeyEvent, targetOwnsArrows: boolean,): 'prev' | 'next' | null {
    if (e.defaultPrevented || targetOwnsArrows) return null;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
    if (e.key === 'ArrowLeft') return 'prev';
    if (e.key === 'ArrowRight') return 'next';
    return null;
}
