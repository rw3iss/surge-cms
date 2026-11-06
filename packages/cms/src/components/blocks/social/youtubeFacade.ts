/**
 * Pure helpers for the YouTube facade in `SocialEmbed` (thumbnail + play
 * button until the visitor taps, then the real player).
 */

/** YouTube's always-present 480×360 thumbnail for a video id. */
export function youtubeFallbackThumb(videoId: string,): string {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId,)}/hqdefault.jpg`;
}

/**
 * Should a loaded / failed facade thumbnail be swapped for the fallback?
 * A stored thumbnail can be `maxresdefault.jpg`, which YouTube answers for
 * many videos with a 404 whose body is a 120×90 grey placeholder — browsers
 * show that body, so `onerror` alone misses it. `naturalWidth` null = the
 * image failed to load at all.
 */
export function needsThumbFallback(src: string, fallback: string, naturalWidth: number | null,): boolean {
    if (!src || src === fallback) return false;
    if (naturalWidth === null) return true;
    return naturalWidth > 0 && naturalWidth <= 120;
}

/** Accessible name for the facade button / player: the title, kept short. */
export function youtubeFacadeLabel(content: string | undefined, max = 100,): string {
    const t = (content ?? '').replace(/\s+/g, ' ',).trim();
    if (!t) return 'YouTube video';
    return t.length > max ? `${t.slice(0, max - 1,).trimEnd()}…` : t;
}

/** The player URL. The id is encoded — it comes from stored post data. */
export function youtubeEmbedSrc(videoId: string,): string {
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId,)}?enablejsapi=1&autoplay=1&playsinline=1`;
}
