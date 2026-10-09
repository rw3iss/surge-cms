/**
 * Cut an HTML fragment to a share of its visible text, keeping it well formed.
 *
 * Used for gated-post samples: the server keeps the first N% of an article's
 * text and nothing after it, so the rest of the article never reaches a reader
 * who may not see it. Tags are kept (a paragraph stays a paragraph), every tag
 * still open at the cut is closed, and the cut moves back to a word boundary.
 *
 * A small scanner, not a DOM: it runs on the server and in tests. It assumes
 * the input is editor output (well-formed); for anything else the result is
 * still balanced, because only tags it saw open are closed.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',],);
/** Content of these never counts as text and is never cut into. */
const RAW = new Set(['script', 'style',],);

const TAG_RE = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>|<!--[\s\S]*?-->/g;

/** Visible characters (entities count as one). */
function textLength(html: string,): number {
    return html.replace(/<[^>]*>/g, '',).replace(/&[#\w]+;/g, '_',).length;
}

/**
 * Keep `ratio` (0–1) of the visible text. Returns the input unchanged when the
 * ratio is ≥ 1, and '' when ≤ 0.
 */
export function truncateHtmlByRatio(html: string, ratio: number,): string {
    if (!html) return '';
    if (ratio >= 1) return html;
    if (ratio <= 0) return '';
    const budget = Math.max(1, Math.round(textLength(html,) * ratio,),);
    return truncateHtmlToChars(html, budget,);
}

/** Keep the first `budget` visible characters, ending on a word boundary. */
export function truncateHtmlToChars(html: string, budget: number,): string {
    const open: string[] = [];
    let out = '';
    let used = 0;
    let i = 0;
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(html,)) !== null) {
        const text = html.slice(i, m.index,);
        if (text) {
            const len = textLength(text,);
            if (used + len >= budget) {
                out += cutText(text, budget - used,);
                return out + closeAll(open,);
            }
            used += len;
            out += text;
        }
        const tag = m[0];
        const name = (m[1] || '').toLowerCase();
        i = TAG_RE.lastIndex;
        if (!name) { out += tag; continue; } // comment
        if (tag.startsWith('</',)) {
            const at = open.lastIndexOf(name,);
            if (at >= 0) open.length = at;
            out += tag;
        } else if (RAW.has(name,)) {
            // Copy the whole raw element through untouched.
            const close = html.toLowerCase().indexOf(`</${name}`, i,);
            const end = close < 0 ? html.length : html.indexOf('>', close,) + 1;
            out += tag + html.slice(i, end,);
            i = end;
            TAG_RE.lastIndex = end;
        } else {
            out += tag;
            if (!VOID.has(name,) && !tag.endsWith('/>',)) open.push(name,);
        }
    }
    const rest = html.slice(i,);
    if (rest) out += used + textLength(rest,) > budget ? cutText(rest, budget - used,) : rest;
    return out + closeAll(open,);
}

function cutText(text: string, keep: number,): string {
    if (keep <= 0) return '';
    // Walk entities as single characters so one is never split.
    let n = 0;
    let j = 0;
    while (j < text.length && n < keep) {
        if (text[j] === '&') {
            const semi = text.indexOf(';', j,);
            j = semi > j && semi - j < 12 ? semi + 1 : j + 1;
        } else j++;
        n++;
    }
    let cut = text.slice(0, j,);
    // Back up to a word boundary unless that would drop nearly everything.
    if (j < text.length && /\S/.test(text[j] ?? '',)) {
        const sp = cut.search(/\s\S*$/,);
        if (sp > cut.length * 0.5) cut = cut.slice(0, sp,);
    }
    return `${cut.replace(/\s+$/, '',)}…`;
}

function closeAll(open: string[],): string {
    return open.slice().reverse().map((t,) => `</${t}>`).join('',);
}
