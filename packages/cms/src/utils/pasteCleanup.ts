/**
 * Clean rich text coming from the clipboard.
 *
 * WHY THIS EXISTS: pasting from a word processor carries inline style on every
 * block element. Google Docs writes
 * `line-height:1.38;margin-top:12pt;margin-bottom:12pt` onto each heading and
 * paragraph, and because an inline style beats any stylesheet, the site's own
 * heading rhythm could never apply to that content. It surfaces later as
 * "the headings have a line-height I never set" — with no obvious source,
 * because the source is the clipboard.
 *
 * WHY IT LIVES IN `cms` AND NOT `@sitesurge/types`: it needs a DOM, and the
 * shared package is deliberately environment-free (the Node API imports it).
 *
 * WHY A DOM AND NOT A REGEX: the input is arbitrary third-party markup. A
 * parser is not defeated by a `>` inside an attribute value.
 */

/**
 * Properties stripped from pasted content.
 *
 * Deliberately NARROW. Most pasted inline style is intent worth keeping —
 * bold, colour, links. These four are the ones that silently override the
 * site's typography and that nobody chose on purpose.
 */
export const STRIPPED_PROPS = ['line-height', 'margin', 'margin-top', 'margin-bottom',];

/**
 * Elements whose pasted `font-size` is dropped as well.
 *
 * A word processor stamps its own body size onto every inline run — a `<span>`
 * carrying `font-size:12pt` is describing the SOURCE document, not a decision
 * anyone made here. Left in place it overrides the paragraph, so the site's
 * Paragraph Font Size setting cannot reach the text, and any element that
 * happens NOT to carry it (a link, once the mail sanitiser strips its style)
 * renders at a visibly different size from the words beside it.
 *
 * Block elements are deliberately NOT included: a heading's size is meaningful,
 * and dropping it would flatten a pasted document's hierarchy.
 */
export const INLINE_FONT_SIZE_TAGS = 'span, a, font, strong, em, b, i, u';

/**
 * Should this tag lose a pasted `font-size`?
 *
 * Exported as a pure predicate so the RULE is testable without a DOM — this
 * package's test environment has none, and adding one just for a selector
 * string is not worth a dependency. The transform itself is verified in a
 * browser.
 */
export function stripsFontSize(tagName: string,): boolean {
    return INLINE_FONT_SIZE_TAGS.split(',',)
        .map((t,) => t.trim())
        .includes(tagName.toLowerCase(),);
}

export function cleanPastedHtml(html: string, doc: Document = document,): string {
    if (!html) return html;

    const root = doc.createElement('div',);
    root.innerHTML = html;

    // Google Docs wraps its payload in a marker span. Harmless to render, but
    // it is the clearest signal the content was pasted, and leaving it makes
    // the stored HTML confusing to read later.
    for (const marker of Array.from(root.querySelectorAll('[id^="docs-internal-guid"]',),)) {
        marker.replaceWith(...Array.from(marker.childNodes,),);
    }

    for (const el of Array.from(root.querySelectorAll('[style]',),)) {
        const style = (el as HTMLElement).style;
        for (const prop of STRIPPED_PROPS) style.removeProperty(prop,);
        if (el.matches(INLINE_FONT_SIZE_TAGS,)) style.removeProperty('font-size',);
        // An emptied style attribute is just noise in the stored HTML.
        if (!(el as HTMLElement).getAttribute('style',)?.trim()) el.removeAttribute('style',);
    }

    return root.innerHTML;
}
