/** Stage 1: split source into literal text + `{{ … }}` tag tokens. */

export type Token =
    | { type: 'text'; value: string }
    | { type: 'tag'; value: string; raw: string };

/**
 * Scan `src` for `{{ … }}` tags. The inner content runs to the first `}}`.
 * Anything not inside a tag is a text token. A `{{` with no closing `}}` is
 * treated as literal text (so stray braces never eat the rest of the doc).
 */
export function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    let text = '';
    const flushText = () => {
        if (text) { tokens.push({ type: 'text', value: text }); text = ''; }
    };

    while (i < src.length) {
        if (src[i] === '{' && src[i + 1] === '{') {
            const end = src.indexOf('}}', i + 2);
            if (end === -1) {
                // Unclosed tag — emit the rest as literal text.
                text += src.slice(i);
                break;
            }
            flushText();
            const raw = src.slice(i, end + 2);
            const inner = src.slice(i + 2, end).trim();
            tokens.push({ type: 'tag', value: inner, raw });
            i = end + 2;
        } else {
            text += src[i];
            i++;
        }
    }
    flushText();
    return tokens;
}

/** Quick check: does the source contain any `{{ … }}` at all? Lets callers skip
 *  the whole pipeline (and any async work) for plain content. */
export function hasTemplateSyntax(src: string | null | undefined): boolean {
    return !!src && src.includes('{{') && src.includes('}}');
}
