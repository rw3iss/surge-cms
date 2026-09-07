/**
 * JavaScript code field — used for a Component's client script.
 * A one-line wrapper over `CodeEditor`; see CssEditor for the rationale.
 */
import { Component, } from 'solid-js';
import CodeEditor, { type CodeEditorProps, } from './CodeEditor';

export type JsEditorProps = Omit<CodeEditorProps, 'language'>;

const JsEditor: Component<JsEditorProps> = (props,) => (
    <CodeEditor {...props} language="javascript" />
);

export default JsEditor;
