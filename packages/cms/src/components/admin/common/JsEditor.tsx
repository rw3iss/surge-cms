/**
 * CodeMirror JavaScript editor — line numbers, syntax highlighting, Tab-to-indent.
 *
 * Shares the HTML block's editor setup rather than reimplementing it, so both
 * behave the same: sync on blur, sync on Ctrl/Cmd+S BEFORE the global save
 * shortcut fires (otherwise a save captures the previous value), and accept
 * external content changes without echoing them back through `onChange`.
 */
import { Component, createEffect, onCleanup, onMount, } from 'solid-js';
import { EditorState, } from '@codemirror/state';
import { EditorView, lineNumbers, } from '@codemirror/view';
import { javascript as jsLang, } from '@codemirror/lang-javascript';
import { basicSetup, } from 'codemirror';
import { indentExtensions, type CodeTabWidth, } from '../../../services/codeIndent';
// Reuses the CSS editor's styles — same chrome, same sizing.
import './CssEditor.scss';

export interface JsEditorProps {
    value: string;
    onChange: (next: string,) => void;
    /** Editor height. Any CSS length. */
    height?: string;
    /** What Tab inserts; from Settings → Appearance → Code tab width. */
    tabWidth?: CodeTabWidth;
    placeholder?: string;
}

const JsEditor: Component<JsEditorProps> = (props,) => {
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
                jsLang(),
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

export default JsEditor;
