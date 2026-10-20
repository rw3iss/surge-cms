import type { JSX, } from 'solid-js';

/**
 * Render `backtick` spans as <code> and **double-star** spans as <strong>.
 *
 * Help prose is written markdown-ish. Split rather than `innerHTML`: the text
 * is authored in-repo (or generated from JSDoc), but building nodes keeps it
 * impossible for a doc string to inject markup. Bold is not applied inside a
 * code span.
 */
export function inlineCode(text: string,): JSX.Element {
    const parts = text.split('`',);
    // Odd indices are the spans between backticks; an unmatched trailing
    // backtick just leaves its text as prose.
    return <>{parts.map((part, i,) => (i % 2 === 1 ? <code>{part}</code> : bold(part,)))}</>;
}

function bold(text: string,): JSX.Element {
    if (!text.includes('**',)) return text;
    const parts = text.split('**',);
    // An unmatched `**` (odd number) leaves the last stretch as prose.
    return <>{parts.map((part, i,) => (i % 2 === 1 && i < parts.length - 1 ? <strong>{part}</strong> : part))}</>;
}
