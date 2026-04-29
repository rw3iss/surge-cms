/**
 * FormField — labeled input row used across admin block editors and
 * settings panels.
 *
 * Two layouts:
 *
 *   default      | label
 *                | <control>            ← stacked (label above)
 *
 *   inline       | label    <control>   ← single row
 *
 * Both share the same label typography (small, semibold) so every
 * admin form reads consistently. Use `tooltip` for an inline help-icon
 * next to the label; use `hint` for sub-text under the control.
 */
import { Component, JSX, Show, } from 'solid-js';
import Tooltip from '../Tooltip';

export interface FormFieldProps {
    label: string;
    /** Optional inline help icon next to the label. Plain string or JSX. */
    tooltip?: string | JSX.Element;
    /** Tooltip header. Defaults to the label text when omitted. */
    tooltipHeader?: string;
    /** Sub-text rendered under the control in muted style. */
    hint?: string;
    /** Single-row layout: label on the left, control on the right. */
    inline?: boolean;
    /** Optional explicit class on the outer wrapper for ad-hoc tweaks. */
    class?: string;
    children: JSX.Element;
}

const FormField: Component<FormFieldProps> = (props,) => {
    return (
        <div class={`admin-form-field ${props.inline ? 'admin-form-field--inline' : ''} ${props.class || ''}`}>
            <label class="admin-form-field__label">
                <span class="admin-form-field__label-text">{props.label}</span>
                <Show when={props.tooltip}>
                    <Tooltip header={props.tooltipHeader || props.label} content={props.tooltip!} />
                </Show>
            </label>
            <div class="admin-form-field__control">
                {props.children}
                <Show when={props.hint}>
                    <span class="admin-form-field__hint">{props.hint}</span>
                </Show>
            </div>
        </div>
    );
};

export default FormField;
