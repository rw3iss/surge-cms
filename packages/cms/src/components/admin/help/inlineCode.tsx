import type { JSX, } from 'solid-js';

/**
 * Render `backtick` spans as <code>.
 *
 * Help prose is written markdown-ish, with backticks around code. Split rather
 * than `innerHTML`: the text is authored in-repo (or generated from JSDoc), but
 * building nodes keeps it impossible for a doc string to inject markup.
 */
export function inlineCode(text: string,): JSX.Element {
    const parts = text.split('`',);
    // Odd indices are the spans between backticks; an unmatched trailing
    // backtick just leaves its text as prose.
    return <>{parts.map((part, i,) => (i % 2 === 1 ? <code>{part}</code> : part))}</>;
}
