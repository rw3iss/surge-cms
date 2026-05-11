/**
 * One input per detected `{{...}}` token in the rendered mail
 * preview. Used inside MailPreviewModal so the operator can fill in
 * sample values and see them substitute live in the iframe.
 */
import { Component, For, } from 'solid-js';

interface Props {
    paths: string[];
    values: Record<string, string>;
    onChange: (next: Record<string, string>,) => void;
}

const VariableForm: Component<Props> = (p,) => {
    return (
        <div class="variable-form">
            <For each={p.paths}>
                {(path,) => (
                    <div class="variable-form__row">
                        <code class="variable-form__path">{`{{${path}}}`}</code>
                        <input
                            type="text"
                            value={p.values[path] ?? ''}
                            onInput={(e,) => p.onChange({ ...p.values, [path]: e.currentTarget.value, },)}
                        />
                    </div>
                )}
            </For>
        </div>
    );
};

export default VariableForm;
