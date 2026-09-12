/**
 * The Social block's "Content type" vocabulary, in one place.
 *
 * The block editor's dropdown and the post-select modal's filter must offer the
 * same options and the same wire values — they filter the same column
 * (`social_posts.media_kind`) through the same query parameter. Two hand-written
 * copies would drift, and a drifted value filters to zero results rather than
 * failing visibly.
 */

/** Wire values accepted by `GET /social/posts/:platform?kind=`. */
export type SocialContentType = 'short' | 'video' | 'live';

export const CONTENT_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string; }> = [
    { value: '', label: 'All content types', },
    { value: 'short', label: 'Shorts', },
    { value: 'video', label: 'Full videos', },
    { value: 'live', label: 'Live / streams', },
];

/**
 * Does this provider classify its items?
 *
 * Only YouTube populates `media_kind`; every other provider stores NULL. So a
 * content-type filter shown for Instagram would not narrow a list, it would
 * empty it — `media_kind = 'video'` matches no row. The control is therefore
 * hidden rather than disabled: an operator cannot misread a control that is not
 * there, and there is nothing useful it could do.
 */
export function providerClassifiesContent(provider: string | undefined,): boolean {
    return provider === 'youtube';
}
