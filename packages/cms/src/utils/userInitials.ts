/** "Ryan Weiss" → "RW"; one word → its first letter; nothing → "?". */
export const userInitials = (name: string | null | undefined,): string =>
    String(name ?? '',).split(/\s+/,).filter(Boolean,).slice(0, 2,).map((p,) => p[0]!.toUpperCase()).join('',) || '?';
