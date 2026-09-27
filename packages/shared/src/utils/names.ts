/**
 * Split a full name into first + last: the first word, then everything else.
 *
 * Used where an account only has a single "name" (registration, an
 * admin-created user, Patreon, a display name) but the profile asks for first
 * and last separately. "Mary Ann van Dyke" → "Mary" / "Ann van Dyke" — wrong
 * for some names, but the person can correct it on their profile, which beats
 * showing them two empty fields under their own name.
 */
export function splitFullName(full: string | null | undefined,): { firstName: string; lastName: string; } {
    const parts = (full ?? '').trim().split(/\s+/,).filter(Boolean,);
    if (parts.length === 0) return { firstName: '', lastName: '', };
    return { firstName: parts[0], lastName: parts.slice(1,).join(' ',), };
}
