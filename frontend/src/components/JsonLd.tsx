import { Component, createEffect, onCleanup, } from 'solid-js';

/**
 * Injects a JSON-LD <script> tag into document.head.
 *
 * We can't use the normal JSX `<script>` here because it would render inside
 * the component subtree (ending up in <body>). Search engines accept JSON-LD
 * in either <head> or <body>, but <head> is the conventional location and
 * keeps our tags grouped with the rest of the meta. We manually create the
 * element, append it to document.head, and remove it on cleanup.
 *
 * The script element is re-created whenever `props.data` changes so the
 * content always reflects the current page's data.
 */
export const JsonLd: Component<{ data: Record<string, any>; }> = (props,) => {
    createEffect(() => {
        if (typeof document === 'undefined') return;
        const script = document.createElement('script',);
        script.type = 'application/ld+json';
        script.setAttribute('data-surge-jsonld', '',);
        script.textContent = JSON.stringify(props.data,);
        document.head.appendChild(script,);
        onCleanup(() => {
            if (script.parentNode) script.parentNode.removeChild(script,);
        },);
    },);

    return null;
};
