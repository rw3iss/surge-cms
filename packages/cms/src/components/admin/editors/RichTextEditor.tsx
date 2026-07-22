import { createEffect, createSignal, type JSX, Show, } from 'solid-js';
import Toggle from '../../ui/Toggle';
import './RichTextEditor.scss';

interface RichTextEditorProps {
    value: string;
    onChange: (html: string,) => void;
    placeholder?: string;
    onImageUpload?: (file: File,) => Promise<string>; // Returns URL
    /** Applied to the editable content area so the admin editor previews the
     *  block's resolved style (background, color, font, alignment, padding). */
    contentStyle?: JSX.CSSProperties;
}

export default function RichTextEditor(props: RichTextEditorProps,) {
    let editorRef: HTMLDivElement | undefined;
    const [showLinkDialog, setShowLinkDialog,] = createSignal(false,);
    const [linkUrl, setLinkUrl,] = createSignal('',);
    // Whether the link should open in a new tab (adds target="_blank").
    const [linkNewWindow, setLinkNewWindow,] = createSignal(false,);

    // The selection is lost once focus moves to the link URL input, so we
    // snapshot the editor's Range when the dialog opens and restore it before
    // applying the link. Without this, execCommand('createLink') runs against
    // an empty/collapsed selection and does nothing.
    let savedRange: Range | null = null;

    const saveSelection = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0,);
            if (editorRef && editorRef.contains(r.commonAncestorContainer,)) {
                savedRange = r.cloneRange();
                return;
            }
        }
        savedRange = null;
    };

    const restoreSelection = (): boolean => {
        if (!savedRange || !editorRef) return false;
        editorRef.focus();
        const sel = window.getSelection();
        if (!sel) return false;
        sel.removeAllRanges();
        sel.addRange(savedRange,);
        return true;
    };

    /** The anchor element wrapping the current selection, if any (for prefill
     *  + replace). Walks up from the selection to the editor root. */
    const anchorInSelection = (): HTMLAnchorElement | null => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        let node: Node | null = sel.getRangeAt(0,).commonAncestorContainer;
        while (node && node !== editorRef) {
            if (node instanceof HTMLAnchorElement) return node;
            node = node.parentNode;
        }
        return null;
    };

    /** All anchor elements that intersect the current selection (the freshly
     *  created link after createLink, or existing links being edited). */
    const anchorsInSelection = (): HTMLAnchorElement[] => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editorRef) return [];
        const range = sel.getRangeAt(0,);
        return Array.from(editorRef.querySelectorAll('a',),).filter(a => range.intersectsNode(a,),);
    };

    const openLinkDialog = () => {
        if (showLinkDialog()) {
            setShowLinkDialog(false,);
            return;
        }
        // Snapshot the selection NOW, while it's still in the editor, and
        // prefill the box + toggle from the existing link (if the selection
        // is one).
        saveSelection();
        const existing = anchorInSelection();
        setLinkUrl(existing?.getAttribute('href',) || '',);
        setLinkNewWindow(existing?.getAttribute('target',) === '_blank',);
        setShowLinkDialog(true,);
    };

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
        const url = linkUrl().trim();
        if (!url) return;
        // Put the caret/selection back where it was before the input stole it.
        // If there's no saved editor selection to restore, bail rather than
        // apply the link to whatever happens to be selected elsewhere.
        if (!restoreSelection()) {
            editorRef?.focus();
            return;
        }
        // Replace any existing link on the selection, then apply the new URL
        // so re-linking previously-linked text swaps the href instead of
        // nesting anchors.
        document.execCommand('unlink', false,);
        document.execCommand('createLink', false, url,);
        // Apply (or clear) the new-window target on the just-created link(s).
        const newWindow = linkNewWindow();
        for (const a of anchorsInSelection()) {
            if (newWindow) {
                a.setAttribute('target', '_blank',);
                a.setAttribute('rel', 'noopener noreferrer',);
            } else {
                a.removeAttribute('target',);
                a.removeAttribute('rel',);
            }
        }
        flush();
        setLinkUrl('',);
        setLinkNewWindow(false,);
        setShowLinkDialog(false,);
        savedRange = null;
        editorRef?.focus();
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
                    <button type="button" onClick={() => execCommand('justifyLeft',)} aria-label="Align Left" title="Align Left">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('justifyCenter',)} aria-label="Align Center" title="Align Center">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('justifyRight',)} aria-label="Align Right" title="Align Right">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('justifyFull',)} aria-label="Justify" title="Justify">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    </button>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('insertUnorderedList',)} aria-label="Bullet List" title="Bullet List">
                        <svg viewBox="0 0 16 16" width="14" height="14"><circle cx="3" cy="4" r="1.5" fill="currentColor"/><circle cx="3" cy="8" r="1.5" fill="currentColor"/><circle cx="3" cy="12" r="1.5" fill="currentColor"/><path d="M6 3.5h8M6 7.5h8M6 11.5h8" stroke="currentColor" stroke-width="1.2"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('insertOrderedList',)} aria-label="Numbered List" title="Numbered List">
                        <svg viewBox="0 0 16 16" width="14" height="14"><text x="1" y="5.5" font-size="5" fill="currentColor" font-weight="700">1</text><text x="1" y="9.5" font-size="5" fill="currentColor" font-weight="700">2</text><text x="1" y="13.5" font-size="5" fill="currentColor" font-weight="700">3</text><path d="M6 3.5h8M6 7.5h8M6 11.5h8" stroke="currentColor" stroke-width="1.2"/></svg>
                    </button>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={openLinkDialog} aria-label="Insert Link" title="Insert Link">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M6.5 9.5l3-3M7 11l-1.5 1.5a2.12 2.12 0 01-3-3L4 8m5-3l1.5-1.5a2.12 2.12 0 013 3L12 8" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <Show when={props.onImageUpload}>
                        <button type="button" onClick={insertImage} aria-label="Insert Image" title="Insert Image">
                            <svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="5" cy="6" r="1.2" fill="currentColor"/><path d="M1.5 11l3.5-3 2.5 2 3-4 4 5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/></svg>
                        </button>
                    </Show>
                </div>
                <div class="rte-toolbar__group">
                    <button type="button" onClick={() => execCommand('removeFormat',)} aria-label="Clear Formatting" title="Clear Formatting">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M8 3h4.5M6 3l-2 10" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('undo',)} aria-label="Undo" title="Undo">
                        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 7l-3-3 3-3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 4h9a4 4 0 010 8H6" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>
                    </button>
                    <button type="button" onClick={() => execCommand('redo',)} aria-label="Redo" title="Redo">
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
                    <Toggle
                        size="sm"
                        checked={linkNewWindow()}
                        onChange={setLinkNewWindow}
                        label="New window"
                    />
                    <button type="button" class="btn btn--primary btn--small" onClick={insertLink}>Insert</button>
                    <button type="button" class="btn btn--secondary btn--small" onClick={() => setShowLinkDialog(false,)}>Cancel</button>
                </div>
            </Show>

            <div
                ref={editorRef}
                class="rte-content"
                contentEditable
                onBlur={flush}
                onKeyDown={handleKeyDown}
                style={props.contentStyle}
                data-placeholder={props.placeholder || 'Start typing...'}
            />
        </div>
    );
}
