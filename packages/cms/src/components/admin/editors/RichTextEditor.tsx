import { createEffect, createSignal, Show, } from 'solid-js';
import './RichTextEditor.scss';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string,) => void;
    placeholder?: string;
    onImageUpload?: (file: File,) => Promise<string>; // Returns URL
}

export default function RichTextEditor(props: RichTextEditorProps,) {
    let editorRef: HTMLDivElement | undefined;
    const [showLinkDialog, setShowLinkDialog,] = createSignal(false,);
    const [linkUrl, setLinkUrl,] = createSignal('',);

    /**
     * Lift the editor's HTML up to the parent — but ONLY when we actually need
     * it (blur, Ctrl/Cmd+S), NOT on every keystroke. Propagating per keystroke
     * pushed a fresh block object into the store on each character, remounting
     * the row and stealing caret focus. The contentEditable div is the source of
     * truth while typing, so deferring the sync loses nothing.
     */
    const flush = () => {
        if (editorRef && editorRef.innerHTML !== props.value) {
            props.onChange(editorRef.innerHTML,);
        }
    };

    // Seed on mount + sync external content changes (e.g. Revert) into the
    // editable div, without echoing them back through onChange. While the user
    // types we never call onChange, so props.value stays put and this effect
    // doesn't fire — the caret is safe.
    createEffect(() => {
        const next = props.value || '';
        if (editorRef && editorRef.innerHTML !== next) {
            editorRef.innerHTML = next;
        }
    },);

    const execCommand = (command: string, value?: string,) => {
        document.execCommand(command, false, value,);
        editorRef?.focus();
    };

    const handleKeyDown = (e: KeyboardEvent,) => {
        // Ctrl+B for bold, Ctrl+I for italic, etc. are handled natively
        if (e.key === 'Tab') {
            e.preventDefault();
            execCommand('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;',);
        }
        // Ctrl/Cmd+S: flush before the global Save shortcut fires so a save
        // while the editor is focused captures the freshest content.
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) flush();
    };

    const insertLink = () => {
        if (linkUrl()) {
            execCommand('createLink', linkUrl(),);
            setLinkUrl('',);
            setShowLinkDialog(false,);
        }
    };

    const insertImage = async () => {
        if (props.onImageUpload) {
            const input = document.createElement('input',);
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async () => {
                const file = input.files?.[0];
                if (file) {
                    try {
                        const url = await props.onImageUpload!(file,);
                        execCommand('insertHTML', `<img src="${url}" alt="" style="max-width:100%" />`,);
                    } catch (e) {
                        console.error('Image upload failed', e,);
                    }
                }
            };
            input.click();
        }
    };

    const formatBlock = (tag: string,) => {
        execCommand('formatBlock', tag,);
    };

    return (
        <div class="rich-text-editor">
            <div class="rte-toolbar">
                <div class="rte-toolbar__group">
                    <select
                        onChange={(e,) => {
                            formatBlock(e.currentTarget.value,);
                            e.currentTarget.value = '';
                        }}
                    >
                        <option value="">Format</option>
                        <option value="p">Paragraph</option>
                        <option value="h1">Heading 1</option>
                        <option value="h2">Heading 2</option>
                        <option value="h3">Heading 3</option>
                        <option value="h4">Heading 4</option>
                        <option value="blockquote">Quote</option>
                        <option value="pre">Code Block</option>
                    </select>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('bold',)} title="Bold (Ctrl+B)">
                        <b>B</b>
                    </button>
                    <button type="button" onClick={() => execCommand('italic',)} title="Italic (Ctrl+I)">
                        <i>I</i>
                    </button>
                    <button type="button" onClick={() => execCommand('underline',)} title="Underline (Ctrl+U)">
                        <u>U</u>
                    </button>
                    <button type="button" onClick={() => execCommand('strikeThrough',)} title="Strikethrough">
                        <s>S</s>
                    </button>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('insertUnorderedList',)} title="Bullet List">
                        <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="3" cy="4" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><path d="M6 3.5h8M6 7.5h8M6 11.5h8" stroke="currentColor" stroke-width="1.2"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('insertOrderedList',)} title="Numbered List">
                        <svg viewBox="0 0 16 16" width="14" height="14"><text x="1" y="5.5" font-size="5" fill="currentColor" font-weight="700">1</text><text x="1" y="9.5" font-size="5" fill="currentColor" font-weight="700">2</text><text x="1" y="13.5" font-size="5" fill="currentColor" font-weight="700">3</text><path d="M6 3.5h8M6 7.5h8M6 11.5h8" stroke="currentColor" stroke-width="1.2"/></svg>
                    </button>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => setShowLinkDialog(!showLinkDialog(),)} title="Insert Link">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.12 2.12 0 01-3-3L4 8m5-3l1.5-1.5a2.12 2.12 0 013 3L12 8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <Show when={props.onImageUpload}>
                        <button type="button" onClick={insertImage} title="Insert Image">
                            <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="5" cy="6" r="1.2" fill="currentColor"/><path d="M1.5 11l3.5-3 2.5 2 3-4 4 5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>
                        </button>
                    </Show>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('removeFormat',)} title="Clear Formatting">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M8 3h4.5M6 3l-2 10" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('undo',)} title="Undo">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 7l-3-3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 4h9a4 4 0 010 8H6" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('redo',)} title="Redo">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M12 7l3-3-3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 4H6a4 4 0 000 8h4" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                </div>
            </div>

            <Show when={showLinkDialog()}>
                <div class="rte-link-dialog">
                    <input
                        type="url"
                        placeholder="Enter URL..."
                        value={linkUrl()}
                        onInput={(e,) => setLinkUrl(e.currentTarget.value,)}
                        onKeyDown={(e,) => e.key === 'Enter' && insertLink()}
                    />
                    <button type="button" onClick={insertLink}>Insert</button>
                    <button type="button" onClick={() => setShowLinkDialog(false,)}>Cancel</button>
                </div>
            </Show>

            <div
                ref={editorRef}
                class="rte-content"
                contentEditable
                onBlur={flush}
                onKeyDown={handleKeyDown}
                data-placeholder={props.placeholder || 'Start typing...'}
            />
        </div>
    );
}
