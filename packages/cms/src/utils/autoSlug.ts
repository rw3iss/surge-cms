/**
 * The slug follows the title while it is still the AUTOMATIC one.
 *
 * On a new post / page (or one with no slug yet), typing the title fills the
 * slug. It stops following the moment the slug no longer equals the slug of
 * the previous title — i.e. the author typed their own — and an existing,
 * saved slug is never rewritten (it is a live URL; changing it breaks links).
 */
import { generateSlug, } from '@sitesurge/types';

/** The slug after the title changed from `prevTitle` to `nextTitle`, or null to leave it. */
export function followTitleSlug(
    prevTitle: string,
    nextTitle: string,
    slug: string,
    opts: { isNew: boolean; },
): string | null {
    if (!opts.isNew && slug.trim()) return null;
    const auto = !slug.trim() || slug === generateSlug(prevTitle,);
    if (!auto) return null;
    const next = generateSlug(nextTitle,);
    return next === slug ? null : next;
}
