/**
 * A small "Copy …" button: puts `text` on the clipboard and says "Copied" for
 * a moment. Used for an item / collection's public link and its `{{gallery()}}`
 * template, which editors otherwise type by hand.
 */
import { createSignal, } from 'solid-js';

export default function CopyButton(p: { text: () => string; label: string; title?: string; },) {
    const [state, setState,] = createSignal<'idle' | 'copied' | 'failed'>('idle',);
    const copy = () => {
        void navigator.clipboard.writeText(p.text(),)
            .then(() => setState('copied',),)
            .catch(() => setState('failed',),)
            .finally(() => setTimeout(() => setState('idle',), 1500,),);
    };
    return (
        <button type="button" class="ui-button ui-button--ghost ui-button--sm" title={p.title ?? p.text()} onClick={copy}>
            {state() === 'copied' ? 'Copied' : state() === 'failed' ? 'Copy failed' : p.label}
        </button>
    );
}

/** Absolute URL for a site-relative path. */
export const absoluteUrl = (path: string,) => (/^https?:\/\//i.test(path,) ? path : `${window.location.origin}${path}`);
