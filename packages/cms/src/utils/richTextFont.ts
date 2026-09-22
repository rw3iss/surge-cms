/**
 * Font stacks for a rich-text selection.
 *
 * A font chosen in the editor is applied to a RUN of text, not the block, so
 * it ends up as an inline `font-family` on a `<span>`. That span will be read
 * in places the site's stylesheet does not reach — most importantly an inbox,
 * where there is no stylesheet at all and no custom properties — so the value
 * written has to be self-contained.
 *
 * Hence: resolve the site's default stack at APPLY time and append it, rather
 * than emitting `var(--site-font, …)`. The saved HTML then carries a literal
 * list that degrades sensibly everywhere, and a reader that has never heard of
 * this CMS still gets the right fallback.
 */

/** Last-resort stack when the site has no font configured. */
export const SYSTEM_FALLBACK = 'system-ui, sans-serif';

/**
 * Build the `font-family` value for a chosen font.
 *
 * `customId` is the Font Manager token (a bare family name). `siteFontStack`
 * is the site's configured default — whatever `--site-font` currently resolves
 * to — and is appended so the selected font FALLS BACK to the site's own font
 * before any system face, which is what an operator means by "use this font
 * for this bit".
 *
 * Returns '' for no selection, so the caller can clear rather than set.
 */
export function inlineFontStack(customId: string, siteFontStack?: string,): string {
    const id = (customId || '').trim();
    if (!id) return '';

    const fallback = (siteFontStack || '').trim();
    // A bare token needs quoting; a value that is already a list (or already
    // quoted) is passed through as the author wrote it.
    const head = id.includes(',',) || id.startsWith('\'',) || id.startsWith('"',) ? id : `'${id}'`;

    // Drop a fallback that merely repeats the chosen font — "'X', 'X', …"
    // is not wrong, but it is noise in every saved document.
    const parts = [head,];
    for (const p of splitStack(fallback,)) {
        if (normalise(p,) !== normalise(head,) && !parts.some(q => normalise(q,) === normalise(p,))) {
            parts.push(p,);
        }
    }
    if (parts.length === 1) parts.push(...splitStack(SYSTEM_FALLBACK,),);
    return parts.join(', ',);
}

/** Split a font-family list, tolerating the spacing a browser hands back. */
function splitStack(stack: string,): string[] {
    return stack.split(',',).map(s => s.trim()).filter(Boolean,);
}

/** Compare family names ignoring quotes and case. */
function normalise(family: string,): string {
    return family.trim().replace(/^["']|["']$/g, '',).toLowerCase();
}

/**
 * The site's default font stack, as currently resolved in the document.
 *
 * Read from the live custom property rather than re-fetching appearance: the
 * admin shell already publishes `--site-font`, so this cannot disagree with
 * what the operator is looking at. Returns '' when unset, which
 * {@link inlineFontStack} turns into the system fallback.
 */
export function siteFontStack(doc: Document = document,): string {
    try {
        return getComputedStyle(doc.documentElement,).getPropertyValue('--site-font',).trim();
    } catch {
        return '';
    }
}
