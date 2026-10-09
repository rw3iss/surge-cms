/**
 * Render a short Markdown string (bold, italics, links, lists, paragraphs) —
 * e.g. subscription tier descriptions. `renderMarkdown` (@sitesurge/types)
 * ESCAPES its input first and emits only its own tags, so the result is safe
 * for innerHTML without a sanitiser. Plain text renders as a paragraph.
 */
import { renderMarkdown, } from '@sitesurge/types';
import { Component, Show, } from 'solid-js';
import './Markdown.scss';

export interface MarkdownProps {
    text: string | null | undefined;
    class?: string;
}

const Markdown: Component<MarkdownProps> = (props,) => {
    const html = () => renderMarkdown(props.text,);
    return (
        <Show when={html()}>
            <div class={`markdown${props.class ? ` ${props.class}` : ''}`} innerHTML={html()} />
        </Show>
    );
};

export default Markdown;
