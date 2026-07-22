/**
 * Inline HTML block editor — replaces the static BlockPreview when an
 * HTML block is selected in the admin editor.
 *
 *  - Header strip exposes a Code ↔ Preview toggle.
 *  - Code mode: CodeMirror 6 with HTML syntax highlighting.
 *  - Preview mode: renders the HTML inside a styled wrapper so the
 *    operator sees what the public site will show.
 *  - Drag handle on the bottom edge resizes the editor; height
 *    persists in localStorage keyed by block id.
 *  - Public output is unaffected by the admin drag — public render
 *    respects the block style's max-height when set.
 */
import { html as htmlLang, } from '@codemirror/lang-html';
import { EditorState, } from '@codemirror/state';
import { EditorView, lineNumbers, } from '@codemirror/view';
import { basicSetup, } from 'codemirror';
import {
    Component,
    createEffect,
    createSignal,
    type JSX,
    onCleanup,
    onMount,
    Show,
} from 'solid-js';
import { formatHtml, } from '../../../utils/codeFormat';

const STORAGE_KEY = 'sitesurge.editor.blockHeights';
const DEFAULT_HEIGHT = 200;
const MIN_HEIGHT = 80;

function readStoredHeight(blockId: string,): number | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY,);
        if (!raw) return null;
        const obj = JSON.parse(raw,) as Record<string, number>;
        const v = obj[blockId];
        return typeof v === 'number' ? v : null;
    } catch {
        return null;
    }
}

function writeStoredHeight(blockId: string, height: number,) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY,);
        const obj = raw ? (JSON.parse(raw,) as Record<string, number>) : {};
        obj[blockId] = height;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj,),);
    } catch {
        // ignore quota / parse errors — height is a UI affordance, not data.
    }
}

interface HtmlInlineEditorProps {
    blockId: string;
    /** Current HTML content (from block.data.content). */
    content: string;
    onChange: (next: string,) => void;
    /** Resolved block style (background/color/font/padding) applied to the
     *  Preview so it matches the main block preview + the public output. */
    contentStyle?: JSX.CSSProperties;
}

const HtmlInlineEditor: Component<HtmlInlineEditorProps> = (props,) => {
    const [mode, setMode,] = createSignal<'code' | 'preview'>('code',);
    const [height, setHeight,] = createSignal<number>(
        readStoredHeight(props.blockId,) ?? DEFAULT_HEIGHT,
    );

    let cmHostEl: HTMLDivElement | undefined;
    let view: EditorView | undefined;

    /**
     * Lift the editor's current text up to the parent — but ONLY at moments we
     * actually need it (blur, Preview toggle, Format, Ctrl+S), NOT on every
     * keystroke. Propagating per keystroke updated the block store on each
     * character, which re-rendered this editor and stole focus. CodeMirror keeps
     * its own document, so nothing is lost by deferring the sync.
     */
    const flush = () => {
        if (!view) return;
        const text = view.state.doc.toString();
        if (text !== props.content) props.onChange(text,);
    };

    onMount(() => {
        if (!cmHostEl) return;
        const startState = EditorState.create({
            doc: props.content || '',
            extensions: [
                basicSetup,
                lineNumbers(),
                htmlLang(),
                EditorView.lineWrapping,
                EditorView.domEventHandlers({
                    // Sync on blur (covers clicking away, Save, or "going back").
                    blur: () => { flush(); return false; },
                    // Ctrl/Cmd+S: flush BEFORE the global Save shortcut runs so the
                    // save captures the freshest content (keydown bubbles from here
                    // to the document-level handler). Don't preventDefault.
                    keydown: (e) => {
                        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) flush();
                        return false;
                    },
                },),
            ],
        },);
        view = new EditorView({ state: startState, parent: cmHostEl, },);
    },);

    onCleanup(() => view?.destroy(),);

    // External content changes (e.g. revert) — sync into CodeMirror without
    // emitting the change back through onChange.
    createEffect(() => {
        const next = props.content || '';
        if (!view) return;
        const current = view.state.doc.toString();
        if (current !== next) {
            view.dispatch({
                changes: { from: 0, to: current.length, insert: next, },
            },);
        }
    },);

    /** Pretty-print the current HTML (and any embedded <style> CSS) and push
     *  it back through onChange. Switches to Code view so the result shows.
     *  Reads from the live editor (state isn't synced per keystroke). */
    const handleFormat = () => {
        const current = view ? view.state.doc.toString() : (props.content || '');
        const next = formatHtml(current,);
        if (next && next !== current) {
            setMode('code',);
            if (view) {
                view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next, }, },);
            }
            props.onChange(next,);
        }
    };

    // ─── Drag-resize ───
    const onResizeStart = (startEvent: PointerEvent,) => {
        startEvent.preventDefault();
        const startY = startEvent.clientY;
        const startH = height();

        const onMove = (e: PointerEvent,) => {
            const next = Math.max(MIN_HEIGHT, startH + (e.clientY - startY),);
            setHeight(next,);
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove,);
            window.removeEventListener('pointerup', onUp,);
            writeStoredHeight(props.blockId, height(),);
        };
        window.addEventListener('pointermove', onMove,);
        window.addEventListener('pointerup', onUp,);
    };

    return (
        // Swallow clicks so they never reach the block's select/deselect
        // handler. CodeMirror's fold gutter re-renders on click (detaching the
        // arrow that was clicked), which made the bubbled click look like a
        // click OUTSIDE the editor to ContentBlock — deselecting the block and
        // dropping back to Preview. The editor only renders while selected, so
        // stopping propagation here costs nothing.
        <div class="html-inline-editor" onClick={(e,) => e.stopPropagation()}>
            <div class="html-inline-editor__toolbar">
                <button
                    type="button"
                    class={`html-inline-editor__tab ${mode() === 'code' ? 'html-inline-editor__tab--active' : ''}`}
                    onClick={() => setMode('code',)}
                    title="Edit raw HTML"
                >
                    {'</> Code'}
                </button>
                <button
                    type="button"
                    class={`html-inline-editor__tab ${mode() === 'preview' ? 'html-inline-editor__tab--active' : ''}`}
                    onClick={() => { flush(); setMode('preview',); }}
                    title="Preview rendered output"
                >
                    Preview
                </button>
                <button
                    type="button"
                    class="html-inline-editor__format"
                    onClick={handleFormat}
                    title="Format the HTML (and embedded CSS) into clean, indented markup"
                >
                    Format
                </button>
            </div>

            <div
                class="html-inline-editor__body"
                style={{ height: `${height()}px`, }}
            >
                {/* CodeMirror is mounted once and shown/hidden so its state
                    survives the toggle. */}
                <div
                    ref={cmHostEl}
                    class="html-inline-editor__cm"
                    style={{ display: mode() === 'code' ? 'block' : 'none', }}
                />
                <Show when={mode() === 'preview'}>
                    <div
                        class="html-inline-editor__preview rich-text"
                        // Apply the resolved block style so the Preview matches
                        // the main block preview + public output (background
                        // image, color, font, padding, …).
                        style={props.contentStyle}
                        // eslint-disable-next-line solid/no-innerhtml
                        innerHTML={props.content || '<p style="color:#999;">No content yet.</p>'}
                    />
                </Show>
            </div>

            <div
                class="html-inline-editor__resizer"
                onPointerDown={onResizeStart}
                title="Drag to resize"
            />
        </div>
    );
};

export default HtmlInlineEditor;
