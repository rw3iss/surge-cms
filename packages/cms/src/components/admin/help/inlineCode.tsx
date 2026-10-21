import type { JSX, } from 'solid-js';

/** One run of help prose: plain text, a `code` span or a **bold** span. */
export type InlineSegment = { kind: 'text' | 'code' | 'bold'; text: string; };

/**
 * Split help prose into text / `code` / **bold** runs. An UNMATCHED delimiter
 * (an odd backtick or `**`) stays in the text as typed — it never turns the
 * rest of the line into code or bold. Bold is not applied inside a code span.
 */
export function splitInline(text: string,): InlineSegment[] {
    const out: InlineSegment[] = [];
    const push = (kind: InlineSegment['kind'], t: string,) => {
        if (!t) return;
        const last = out[out.length - 1];
        if (last && last.kind === kind && kind === 'text') last.text += t;
        else out.push({ kind, text: t, },);
    };
    const spans = (src: string, delim: string, kind: 'code' | 'bold', rest: (t: string,) => void,) => {
        const parts = src.split(delim,);
        parts.forEach((part, i,) => {
            // Odd index = between a delimiter pair; the last part of an
            // even-length split had no closing delimiter.
            if (i % 2 === 1 && i < parts.length - 1) push(kind, part,);
            else rest(i % 2 === 1 ? delim + part : part,);
        },);
    };
    spans(text, '`', 'code', (t,) => spans(t, '**', 'bold', (p,) => push('text', p,),),);
    return out;
}

/**
 * Render `backtick` spans as <code> and **double-star** spans as <strong>.
 *
 * Help prose is written markdown-ish. Built as nodes rather than `innerHTML`:
 * the text is authored in-repo (or generated from JSDoc), but building nodes
 * keeps it impossible for a doc string to inject markup.
 */
export function inlineCode(text: string,): JSX.Element {
    if (!text.includes('`',) && !text.includes('**',)) return text;
    return (
        <>
            {splitInline(text,).map((s,) =>
                s.kind === 'code' ? <code>{s.text}</code> : s.kind === 'bold' ? <strong>{s.text}</strong> : s.text
            )}
        </>
    );
}
