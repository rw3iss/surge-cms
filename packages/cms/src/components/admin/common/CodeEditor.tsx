/**
 * CodeMirror editor — line numbers, syntax highlighting, Tab-to-indent.
 *
 * ONE implementation for every admin code field. `CssEditor` and `JsEditor`
 * were identical apart from the language extension and their doc comments,
 * which meant two copies of the same three subtleties:
 *
 *   - sync on BLUR, not per keystroke (the house rule for text inputs);
 *   - sync on Ctrl/Cmd+S *before* the global save shortcut fires, or a save
 *     captures the previous value;
 *   - accept external content changes without echoing them back through
 *     `onChange`, which would fight the parent.
 *
 * A second copy of that is exactly what drifts, so the language is a prop and
 * the two named editors are one-line wrappers.
 *
 * Extracted verbatim from CssEditor: behaviour is unchanged on purpose.
 */
import { Component, createEffect, onCleanup, onMount, } from 'solid-js';
import { EditorState, } from '@codemirror/state';
import { EditorView, lineNumbers, } from '@codemirror/view';
import { css as cssLang, } from '@codemirror/lang-css';
import { javascript as jsLang, } from '@codemirror/lang-javascript';
import { basicSetup, } from 'codemirror';
import { indentExtensions, type CodeTabWidth, } from '../../../services/codeIndent';
import './CssEditor.scss';

export type CodeLanguage = 'css' | 'javascript';

/** Language -> CodeMirror extension. A record rather than a switch so a new
 *  language is one entry and the type stays exhaustive. */
const LANGUAGES = {
    css: cssLang,
    javascript: jsLang,
} as const satisfies Record<CodeLanguage, unknown>;

export interface CodeEditorProps {
    value: string;
    onChange: (next: string,) => void;
    /** Which grammar to highlight. Read once at mount — CodeMirror needs a
     *  reconfigure to change language, and no call site switches mid-life. */
    language: CodeLanguage;
    /** Editor height. Any CSS length. */
    height?: string;
    /** What Tab inserts; from Settings → Appearance → Code tab width. */
    tabWidth?: CodeTabWidth;
    placeholder?: string;
}

const CodeEditor: Component<CodeEditorProps> = (props,) => {
    let hostEl: HTMLDivElement | undefined;
    let view: EditorView | undefined;

    const flush = () => {
        if (!view) return;
        const text = view.state.doc.toString();
        if (text !== props.value) props.onChange(text,);
    };

    onMount(() => {
        if (!hostEl) return;
        const state = EditorState.create({
            doc: props.value || '',
            extensions: [
                basicSetup,
                lineNumbers(),
                LANGUAGES[props.language](),
                ...indentExtensions(props.tabWidth,),
                EditorView.lineWrapping,
                EditorView.domEventHandlers({
                    blur: () => { flush(); return false; },
                    keydown: (e,) => {
                        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) flush();
                        return false;
                    },
                },),
            ],
        },);
        view = new EditorView({ state, parent: hostEl, },);
    },);

    onCleanup(() => view?.destroy(),);

    // External changes (revert, load) — write into the doc without emitting.
    createEffect(() => {
        const next = props.value || '';
        if (!view) return;
        if (view.state.doc.toString() === next) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next, },
        },);
    },);

    return (
        <div
            class="css-editor"
            style={{ '--css-editor-height': props.height ?? '260px', }}
            ref={(el,) => { hostEl = el; }}
        />
    );
};

export default CodeEditor;
