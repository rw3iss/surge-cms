/**
 * Pure helpers for the Rumble facade in `SocialEmbed` (thumbnail + play
 * button until the visitor taps, then the real player) — same pattern as
 * YouTube, so a feed of Rumble videos mounts no iframes until one is played.
 */

/** Rumble's player id: `v` + base36 of the numeric video id (`449778068` → `v7fsaz8`). */
export function rumbleEmbedId(externalId: string, rawEmbedId?: unknown,): string | null {
    if (typeof rawEmbedId === 'string' && /^v[0-9a-z]+$/.test(rawEmbedId,)) return rawEmbedId;
    const n = Number(externalId,);
    return Number.isSafeInteger(n,) && n > 0 ? `v${n.toString(36,)}` : null;
}

/** The player URL (`autoplay=2`: the tap that created the player starts it). */
export function rumbleEmbedSrc(embedId: string,): string {
    return `https://rumble.com/embed/${encodeURIComponent(embedId,)}/?autoplay=2`;
}

/** Accessible name for the facade button / player: the title, kept short. */
export function rumbleFacadeLabel(content: string | undefined, max = 100,): string {
    const t = (content ?? '').replace(/\s+/g, ' ',).trim();
    if (!t) return 'Rumble video';
    return t.length > max ? `${t.slice(0, max - 1,).trimEnd()}…` : t;
}
