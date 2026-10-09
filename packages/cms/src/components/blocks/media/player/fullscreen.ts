/**
 * Fullscreen helpers: the standard API (+ webkit prefix) on the player
 * container, falling back to iOS Safari's video-only `webkitEnterFullscreen`.
 */

type FsDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitFullscreenEnabled?: boolean;
    webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void; };
type IosVideo = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
    webkitSupportsFullscreen?: boolean;
};

const doc = () => document as FsDocument;

export function fullscreenElement(): Element | null {
    return document.fullscreenElement ?? doc().webkitFullscreenElement ?? null;
}

function containerApi(): boolean {
    return Boolean(document.fullscreenEnabled || doc().webkitFullscreenEnabled,);
}

export function canFullscreen(video: HTMLVideoElement,): boolean {
    return containerApi() || typeof (video as IosVideo).webkitEnterFullscreen === 'function';
}

export function isFullscreen(container: HTMLElement, video: HTMLVideoElement,): boolean {
    return fullscreenElement() === container || Boolean((video as IosVideo).webkitDisplayingFullscreen,);
}

export async function toggleFullscreen(container: HTMLElement, video: HTMLVideoElement,): Promise<void> {
    const v = video as IosVideo;
    try {
        if (isFullscreen(container, video,)) {
            if (v.webkitDisplayingFullscreen) v.webkitExitFullscreen?.();
            else if (document.exitFullscreen) await document.exitFullscreen();
            else await doc().webkitExitFullscreen?.();
            return;
        }
        if (containerApi()) {
            const el = container as FsElement;
            if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide', },);
            else await el.webkitRequestFullscreen?.();
        } else {
            v.webkitEnterFullscreen?.();
        }
    } catch {
        // Refused (no user gesture, iframe without allowfullscreen) — nothing to do.
    }
}

/** Subscribe to fullscreen changes for this player; returns the unsubscribe. */
export function onFullscreenChange(
    container: HTMLElement,
    video: HTMLVideoElement,
    cb: (fs: boolean,) => void,
): () => void {
    const fire = () => cb(isFullscreen(container, video,),);
    const docEvents = ['fullscreenchange', 'webkitfullscreenchange',];
    const videoEvents = ['webkitbeginfullscreen', 'webkitendfullscreen',];
    for (const e of docEvents) document.addEventListener(e, fire,);
    for (const e of videoEvents) video.addEventListener(e, fire,);
    return () => {
        for (const e of docEvents) document.removeEventListener(e, fire,);
        for (const e of videoEvents) video.removeEventListener(e, fire,);
    };
}
