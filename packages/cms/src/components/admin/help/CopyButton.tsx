import { Component, createSignal, onCleanup, } from 'solid-js';

/** Small "Copy" button for a signature / path. Shows "Copied" for a moment. */
const CopyButton: Component<{ text: string; label?: string; }> = (props,) => {
    const [copied, setCopied,] = createSignal(false,);
    let timer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(timer,));

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(props.text,);
            setCopied(true,);
            clearTimeout(timer,);
            timer = setTimeout(() => setCopied(false,), 1200,);
        } catch {
            // Clipboard denied (insecure origin / permissions): nothing to do —
            // the text is on screen to select by hand.
        }
    };

    return (
        <button
            type="button"
            class="ref-copy"
            classList={{ 'ref-copy--done': copied(), }}
            onClick={copy}
            title={props.label ?? 'Copy'}
            aria-label={props.label ?? 'Copy'}
        >
            {copied() ? 'Copied' : 'Copy'}
        </button>
    );
};

export default CopyButton;
