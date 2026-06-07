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
    onCleanup,
    onMount,
    Show,
} from 'solid-js';

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
}

const HtmlInlineEditor: Component<HtmlInlineEditorProps> = (props,) => {
    const [mode, setMode,] = createSignal<'code' | 'preview'>('code',);
    const [height, setHeight,] = createSignal<number>(
        readStoredHeight(props.blockId,) ?? DEFAULT_HEIGHT,
    );

    let cmHostEl: HTMLDivElement | undefined;
    let view: EditorView | undefined;

    onMount(() => {
        if (!cmHostEl) return;
        const startState = EditorState.create({
            doc: props.content || '',
            extensions: [
                basicSetup,
                lineNumbers(),
                htmlLang(),
                EditorView.lineWrapping,
                EditorView.updateListener.of((update,) => {
                    if (update.docChanged) {
                        const text = update.state.doc.toString();
                        // Compare to props.content to avoid feedback loops
                        // when the parent re-emits the same string.
                        if (text !== props.content) props.onChange(text,);
                    }
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
        <div class="html-inline-editor">
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
                    onClick={() => setMode('preview',)}
                    title="Preview rendered output"
                >
                    Preview
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
