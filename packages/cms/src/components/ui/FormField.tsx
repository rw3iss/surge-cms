import { Component, JSX, Show, createUniqueId, } from 'solid-js';
import './FormField.scss';

export interface FormFieldProps {
    label?: string;
    hint?: string;
    error?: string;
    required?: boolean;
    /** When provided, the wrapper passes htmlFor down via the
     * accompanying child's id by way of the render-prop variant. Plain
     * children fall back to a stable generated id rendered alongside
     * the label.  */
    children: JSX.Element | ((id: string,) => JSX.Element);
    inputId?: string;
    /** Layout: stacked = label above (default); inline = label left, control right. */
    layout?: 'stacked' | 'inline';
}

/**
 * Wrapper that gives every form input the same vertical rhythm:
 * label / control / hint / error in a single column with consistent
 * spacing. Passing a render-prop child lets the input pick up the
 * generated id, which the label points to via `for`.
 */
export const FormField: Component<FormFieldProps> = (props,) => {
    const generatedId = createUniqueId();
    const id = () => props.inputId ?? generatedId;

    return (
        <div
            class={`ui-form-field ui-form-field--${props.layout ?? 'stacked'} ${props.error ? 'has-error' : ''}`}
        >
            <Show when={props.label}>
                <label class="ui-form-field__label" for={id()}>
                    <span>{props.label}</span>
                    <Show when={props.required}>
                        <span class="ui-form-field__required" aria-hidden="true">*</span>
                    </Show>
                </label>
            </Show>
            <div class="ui-form-field__control">
                {typeof props.children === 'function' ? (props.children as (id: string,) => JSX.Element)(id(),) : props.children}
            </div>
            <Show when={props.hint && !props.error}>
                <p class="ui-form-field__hint">{props.hint}</p>
            </Show>
            <Show when={props.error}>
                <p class="ui-form-field__error" role="alert">{props.error}</p>
            </Show>
        </div>
    );
};

export default FormField;
