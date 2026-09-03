/**
 * Markdown editor with a formatting toolbar and a preview tab.
 *
 * Modelled on the Custom HTML block's edit/preview toggle so the two feel like
 * one product. Deliberately a plain `<textarea>` rather than a rich-text
 * contenteditable: the stored value IS markdown, and a WYSIWYG surface that
 * round-trips through HTML is how markdown quietly acquires stray tags.
 *
 * The toolbar edits the TEXT — it wraps or prefixes the selection and restores
 * the cursor — so everything it does is reproducible by typing, and nothing it
 * produces is unrepresentable in the source.
 */
import { Component, createSignal, For, Show, } from 'solid-js';
import { renderMarkdown, } from '@sitesurge/types';
import './MarkdownEditor.scss';

export interface MarkdownEditorProps {
    value: string;
    onChange: (next: string,) => void;
    placeholder?: string;
    /** Editor height. Any CSS length; defaults to a comfortable writing area. */
    height?: string;
    label?: string;
}

interface ToolAction {
    label: string;
    title: string;
    /** Wrap the selection, e.g. ** … ** */
    wrap?: [string, string,];
    /** Prefix each selected line, e.g. '## ' or '- '. */
    linePrefix?: string;
    /** Text inserted when nothing is selected. */
    placeholder?: string;
}

const TOOLS: ToolAction[] = [
    { label: 'H1', title: 'Heading 1', linePrefix: '# ', },
    { label: 'H2', title: 'Heading 2', linePrefix: '## ', },
    { label: 'H3', title: 'Heading 3', linePrefix: '### ', },
    { label: 'B', title: 'Bold', wrap: ['**', '**',], placeholder: 'bold text', },
    { label: 'I', title: 'Italic', wrap: ['*', '*',], placeholder: 'italic text', },
    { label: 'S', title: 'Strikethrough', wrap: ['~~', '~~',], placeholder: 'struck', },
    { label: '</>', title: 'Inline code', wrap: ['`', '`',], placeholder: 'code', },
    { label: '“ ”', title: 'Quote', linePrefix: '> ', },
    { label: '• List', title: 'Bulleted list', linePrefix: '- ', },
    { label: '1. List', title: 'Numbered list', linePrefix: '1. ', },
    { label: 'Link', title: 'Link', wrap: ['[', '](https://)',], placeholder: 'text', },
    { label: '—', title: 'Horizontal rule', linePrefix: '', placeholder: '\n---\n', },
];

const MarkdownEditor: Component<MarkdownEditorProps> = (props,) => {
    const [tab, setTab,] = createSignal<'write' | 'preview'>('write',);
    let textarea: HTMLTextAreaElement | undefined;

    /**
     * Apply a toolbar action to the current selection.
     *
     * Restoring the selection afterwards is the difference between a usable
     * toolbar and one that makes you re-find your place after every click.
     */
    const apply = (tool: ToolAction,) => {
        const el = textarea;
        if (!el) return;
        const value = props.value ?? '';
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selected = value.slice(start, end,);

        let next: string;
        let cursorStart: number;
        let cursorEnd: number;

        if (tool.linePrefix !== undefined && tool.linePrefix !== '') {
            // Prefix every line the selection touches, expanding to line bounds
            // so a partial selection still formats the whole line.
            const lineStart = value.lastIndexOf('\n', start - 1,) + 1;
            const lineEnd = value.indexOf('\n', end,) === -1 ? value.length : value.indexOf('\n', end,);
            const block = value.slice(lineStart, lineEnd,) || (tool.placeholder ?? '');
            const prefixed = block.split('\n',).map((l,) => `${tool.linePrefix}${l}`).join('\n',);
            next = value.slice(0, lineStart,) + prefixed + value.slice(lineEnd,);
            cursorStart = lineStart;
            cursorEnd = lineStart + prefixed.length;
        } else if (tool.wrap) {
            const [open, close,] = tool.wrap;
            const body = selected || tool.placeholder || '';
            next = value.slice(0, start,) + open + body + close + value.slice(end,);
            // Select the BODY, so typing replaces the placeholder immediately.
            cursorStart = start + open.length;
            cursorEnd = cursorStart + body.length;
        } else {
            const insert = tool.placeholder ?? '';
            next = value.slice(0, start,) + insert + value.slice(end,);
            cursorStart = cursorEnd = start + insert.length;
        }

        props.onChange(next,);
        queueMicrotask(() => {
            el.focus();
            el.setSelectionRange(cursorStart, cursorEnd,);
        },);
    };

    return (
        <div class="md-editor">
            <div class="md-editor__bar">
                <div class="md-editor__tools">
                    <For each={TOOLS}>
                        {(tool,) => (
                            <button
                                type="button"
                                class="md-editor__tool"
                                title={tool.title}
                                aria-label={tool.title}
                                // The toolbar must not steal focus, or the
                                // selection it is about to act on is lost.
                                onMouseDown={(e,) => e.preventDefault()}
                                onClick={() => apply(tool,)}
                                disabled={tab() !== 'write'}
                            >
                                {tool.label}
                            </button>
                        )}
                    </For>
                </div>

                <div class="md-editor__tabs">
                    <button
                        type="button"
                        class={`md-editor__tab${tab() === 'write' ? ' md-editor__tab--active' : ''}`}
                        onClick={() => setTab('write',)}
                    >Write</button>
                    <button
                        type="button"
                        class={`md-editor__tab${tab() === 'preview' ? ' md-editor__tab--active' : ''}`}
                        onClick={() => setTab('preview',)}
                    >Preview</button>
                </div>
            </div>

            <Show
                when={tab() === 'write'}
                fallback={
                    <div
                        class="md-editor__preview rich-text"
                        style={{ 'min-height': props.height ?? '480px', }}
                        // renderMarkdown escapes before it formats, so its
                        // output is safe to inject without a sanitiser pass.
                        innerHTML={renderMarkdown(props.value,) || '<p class="md-editor__empty">Nothing to preview yet.</p>'}
                    />
                }
            >
                <textarea
                    ref={textarea}
                    class="md-editor__input"
                    style={{ height: props.height ?? '480px', }}
                    value={props.value ?? ''}
                    placeholder={props.placeholder ?? 'Write in markdown…'}
                    onInput={(e,) => props.onChange(e.currentTarget.value,)}
                    spellcheck
                />
            </Show>
        </div>
    );
};

export default MarkdownEditor;
