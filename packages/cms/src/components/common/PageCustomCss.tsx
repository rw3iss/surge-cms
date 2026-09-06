/**
 * Render a page's CSS overrides.
 *
 * Mounted last in the page tree so the rules land after the page's own
 * stylesheet and win on equal specificity — that is the whole point of the
 * feature, and it is why this is a plain trailing `<style>` rather than
 * something injected into `<head>`.
 *
 * ## The one escaping rule that matters
 *
 * The content is operator-authored, and an operator is not an attacker — but a
 * stray `</style>` inside it would CLOSE the element early and put everything
 * after it into the document as markup. That turns a typo into injected HTML,
 * so the sequence is neutralised before it reaches the DOM. Nothing here is
 * ever executed; CSS is not script.
 */
import { Component, Show, } from 'solid-js';

/** Break any `</style` sequence so it cannot terminate the element early. */
export function sanitiseCss(css: string,): string {
    // `<\/style` is inert to the CSS parser (an escaped solidus in a selector
    // position is simply invalid and skipped) but no longer matches the HTML
    // tokenizer's end-tag scan.
    return css.replace(/<\/(style)/gi, '<\\/$1',);
}

const PageCustomCss: Component<{ css?: string | null; }> = (props,) => (
    <Show when={(props.css ?? '').trim()}>
        {(css,) => <style>{sanitiseCss(css(),)}</style>}
    </Show>
);

export default PageCustomCss;
