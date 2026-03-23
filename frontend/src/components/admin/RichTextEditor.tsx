import { createSignal, onMount, Show, } from 'solid-js';
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

    onMount(() => {
        if (editorRef && props.value) {
            editorRef.innerHTML = props.value;
        }
    },);

    const execCommand = (command: string, value?: string,) => {
        document.execCommand(command, false, value,);
        editorRef?.focus();
        handleInput();
    };

    const handleInput = () => {
        if (editorRef) {
            props.onChange(editorRef.innerHTML,);
        }
    };

    const handleKeyDown = (e: KeyboardEvent,) => {
        // Ctrl+B for bold, Ctrl+I for italic, etc. are handled natively
        if (e.key === 'Tab') {
            e.preventDefault();
            execCommand('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;',);
        }
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
                        &#8226; List
                    </button>
                    <button type="button" onClick={() => execCommand('insertOrderedList',)} title="Numbered List">
                        1. List
                    </button>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => setShowLinkDialog(!showLinkDialog(),)} title="Insert Link">
                        Link
                    </button>
                    <Show when={props.onImageUpload}>
                        <button type="button" onClick={insertImage} title="Insert Image">Image</button>
                    </Show>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('removeFormat',)} title="Clear Formatting">
                        Clear
                    </button>
                    <button type="button" onClick={() => execCommand('undo',)} title="Undo">Undo</button>
                    <button type="button" onClick={() => execCommand('redo',)} title="Redo">Redo</button>
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
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                data-placeholder={props.placeholder || 'Start typing...'}
            />
        </div>
    );
}
