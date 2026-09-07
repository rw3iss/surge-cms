/**
 * CSS code field. A one-line wrapper over `CodeEditor`, which owns the
 * behaviour both editors share (blur sync, Ctrl/Cmd+S flush ordering, external
 * value handling). Kept as a named component so call sites read as intent
 * rather than configuration.
 */
import { Component, } from 'solid-js';
import CodeEditor, { type CodeEditorProps, } from './CodeEditor';

export type CssEditorProps = Omit<CodeEditorProps, 'language'>;

const CssEditor: Component<CssEditorProps> = (props,) => (
    <CodeEditor {...props} language="css" />
);

export default CssEditor;
