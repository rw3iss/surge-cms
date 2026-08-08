/**
 * Resolve the effective image source for a header/footer image or image_link
 * item. An external `imageUrl` override wins when non-empty; otherwise the
 * selected media-library asset URL (`mediaUrl`) is used. Shared by the public
 * renderers and the admin editors so both resolve the src identically.
 */
export function resolveImageSrc(
    imageUrl: string | undefined | null,
    mediaUrl: string | undefined | null,
): string {
    const url = (imageUrl ?? '').trim();
    return url || (mediaUrl ?? '') || '';
}
