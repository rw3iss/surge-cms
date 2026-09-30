/**
 * Where content shows its featured image, read it from the MEDIA OBJECT
 * (`featuredMedia.path`, attached by the server), falling back to the stored
 * `featuredImage` URL for records that predate it or were built client-side.
 * One helper so every renderer resolves the image the same way.
 */
interface WithFeaturedMedia {
    featuredImage?: string | null;
    featuredMedia?: { path?: string | null; alt?: string | null; } | null;
}

export function featuredImagePath(rec: WithFeaturedMedia | null | undefined,): string {
    return rec?.featuredMedia?.path || rec?.featuredImage || '';
}

/** The media library's alt text, else the supplied fallback (usually the title). */
export function featuredImageAlt(rec: WithFeaturedMedia | null | undefined, fallback = '',): string {
    return rec?.featuredMedia?.alt || fallback;
}
