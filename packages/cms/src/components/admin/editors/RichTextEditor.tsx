import { createEffect, createSignal, type JSX, onCleanup, onMount, Show, } from 'solid-js';
import { cleanPastedHtml, } from '../../../utils/pasteCleanup';
import { inlineFontStack, siteFontStack, } from '../../../utils/richTextFont';
import FontSelect from '../common/FontSelect';
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
    /** The font shown in the toolbar picker. Reflects the last applied
     *  choice; it is not read back from the caret. */
    const [font, setFont,] = createSignal('',);

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

    /**
     * Remember the selection whenever it is inside the editor — and ONLY then.
     *
     * `saveSelection()` above clears the snapshot when the selection is
     * elsewhere, which is right for the link dialog (it snapshots at the moment
     * it opens) but fatal here: clicking a toolbar control moves focus out of
     * the editor, so a tracker that cleared on "outside" would wipe the very
     * range the control is about to act on.
     *
     * This is why the font picker did nothing at all. `restoreSelection()`
     * returned false, `applyFont` bailed before touching the document, and the
     * dropdown never even updated — no error anywhere, just an inert control.
     */
    const trackSelection = (): void => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editorRef) return;
        const r = sel.getRangeAt(0,);
        if (editorRef.contains(r.commonAncestorContainer,)) savedRange = r.cloneRange();
    };

    onMount(() => {
        // `selectionchange` is the only event that fires for every way a
        // selection can change — mouse, keyboard, touch, and programmatic.
        document.addEventListener('selectionchange', trackSelection,);
    },);
    onCleanup(() => {
        document.removeEventListener('selectionchange', trackSelection,);
    },);

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

    /**
     * Clean pasted rich text before it enters the document.
     *
     * A word processor puts `line-height` and `margin` on every heading and
     * paragraph it copies. Inline style beats any stylesheet, so that content
     * permanently overrides the site's typography — and the operator has no
     * idea where it came from, because they only pressed Ctrl+V.
     *
     * Plain-text pastes fall through to the browser untouched; there is
     * nothing to clean and intercepting them would lose the native behaviour.
     */
    const handlePaste = (e: ClipboardEvent,): void => {
        const html = e.clipboardData?.getData('text/html',);
        if (!html) return;
        e.preventDefault();
        document.execCommand('insertHTML', false, cleanPastedHtml(html,),);
        flush();
    };

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

    /**
     * Apply a Font-Manager font to the current selection.
     *
     * `styleWithCSS` is what makes `fontName` emit a `<span style="font-family:…">`
     * instead of a deprecated `<font face>`: a face attribute takes a BARE
     * family name, so it could carry neither the quotes a multi-word family
     * needs nor the fallback list — and the fallback is the whole point when
     * this text is read in an inbox.
     *
     * execCommand rather than hand-wrapping the Range because it already
     * handles the cases that make a naive wrap wrong: a selection spanning
     * several elements, a partial text node, and merging with an adjacent run
     * that already has the same font.
     */
    /**
     * Strip the inline `font-family` from every element the selection touches,
     * leaving all other formatting intact.
     *
     * A span that carried nothing but the font is unwrapped rather than left
     * behind as an empty wrapper — otherwise clearing and re-applying a few
     * times leaves a pile of meaningless spans in the saved HTML.
     */
    const clearFontFamily = (): void => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || !editorRef) return;
        const range = sel.getRangeAt(0,);
        const styled = Array.from(editorRef.querySelectorAll<HTMLElement>('[style*="font-family"]',),)
            .filter(el => range.intersectsNode(el,));
        for (const el of styled) {
            el.style.removeProperty('font-family',);
            const hasOtherStyle = (el.getAttribute('style',) || '').trim() !== '';
            const isBareSpan = el.tagName === 'SPAN' && !hasOtherStyle && !el.className;
            if (!hasOtherStyle) el.removeAttribute('style',);
            if (isBareSpan) el.replaceWith(...Array.from(el.childNodes,),);
        }
    };

    const applyFont = (customId: string,) => {
        if (!restoreSelection()) return;
        const stack = inlineFontStack(customId, siteFontStack(),);
        document.execCommand('styleWithCSS', false, 'true',);
        if (stack) {
            document.execCommand('fontName', false, stack,);
        } else {
            // Clearing removes ONLY the inline family, so the block's own font
            // applies again. Not `removeFormat`, which would also strip bold,
            // italic and links from the selection — clearing a font should not
            // cost the author their emphasis. And not "apply the default",
            // which would pin the run to whatever the default happens to be
            // today.
            clearFontFamily();
        }
        document.execCommand('styleWithCSS', false, 'false',);
        setFont(customId,);
        props.onChange?.(editorRef?.innerHTML ?? '',);
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
                    {/* Font — the same picker the Appearance / header / footer
                        editors use, so an operator sees one font list with the
                        same previews everywhere. */}
                    <FontSelect
                        class="rte-toolbar__font"
                        value={font()}
                        noneLabel="Font"
                        onChange={applyFont}
                    />
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
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" onClick={insertLink}>Insert</button>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setShowLinkDialog(false,)}>Cancel</button>
                </div>
            </Show>

            <div
                ref={editorRef}
                class="rte-content"
                contentEditable
                onBlur={flush}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                style={props.contentStyle}
                data-placeholder={props.placeholder || 'Start typing...'}
            />
        </div>
    );
}
