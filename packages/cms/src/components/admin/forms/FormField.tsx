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
import Tooltip from '../common/Tooltip';
import { labelClickActivates, } from '../../../utils/labelActivation';
// Self-load the shared form styles so labels are styled even when FormField is
// imported directly (not via the `../forms` barrel). Vite dedupes the import.
import './forms.scss';

export interface FormFieldProps {
    label: string;
    /** Lighter, normal-case text after the label (e.g. "(supports {{variables}})").
     *  Not uppercased/tracked like the label — it reads as a soft annotation. */
    labelSuffix?: string | JSX.Element;
    /** Mark the field required — shows a `*` after the label. */
    required?: boolean;
    /** Optional inline help icon next to the label. Plain string or JSX. */
    tooltip?: string | JSX.Element;
    /** Tooltip header. Defaults to the label text when omitted. */
    tooltipHeader?: string;
    /** Sub-text rendered under the control in muted style. */
    hint?: string;
    /** Validation message. When set, the field is styled invalid and this
     *  replaces the hint (an error is more urgent than help text). */
    error?: string;
    /** Single-row layout: label on the left, control on the right. */
    inline?: boolean;
    /** Optional explicit class on the outer wrapper for ad-hoc tweaks. */
    class?: string;
    children: JSX.Element;
}

const FormField: Component<FormFieldProps> = (props,) => {
    /**
     * Clicking the label activates the field's control.
     *
     * The label is a SIBLING of the control, not its parent, so the native
     * `<label>` behaviour never applied here — no `for` attribute and no
     * labelable descendant means clicking the words did nothing, for a switch
     * or a text input alike.
     *
     * A `role="switch"` is toggled (it is a button, which a `<label>` cannot
     * target even with `for`); anything else is merely FOCUSED, which is what a
     * native label does. Focusing rather than clicking matters for a select:
     * a synthetic click would not open it, and clicking twice to open a dropdown
     * is worse than once.
     */
    const onLabelClick = (e: MouseEvent,): void => {
        const boundary = e.currentTarget as HTMLElement;
        if (!labelClickActivates(e.target as HTMLElement | null, boundary,)) return;
        const control = boundary.parentElement?.querySelector('.admin-form-field__control',);
        if (!control) return;

        const sw = control.querySelector<HTMLElement>('[role="switch"]:not([disabled])',);
        if (sw) {
            sw.click();
            return;
        }
        const field = control.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
        );
        field?.focus();
    };

    return (
        <div
            class={`admin-form-field ${props.inline ? 'admin-form-field--inline' : ''} ${
                props.error ? 'admin-form-field--invalid' : ''
            } ${props.class || ''}`}
        >
            <label class="admin-form-field__label" onClick={onLabelClick}>
                <span class="admin-form-field__label-text">{props.label}</span>
                <Show when={props.required}>
                    <span class="admin-form-field__required" aria-hidden="true" title="Required">*</span>
                </Show>
                <Show when={props.labelSuffix}>
                    <span class="admin-form-field__label-suffix">{props.labelSuffix}</span>
                </Show>
                <Show when={props.tooltip}>
                    <Tooltip header={props.tooltipHeader || props.label} content={props.tooltip!} />
                </Show>
            </label>
            <div class="admin-form-field__control">
                {props.children}
                <Show when={props.error}>
                    {/* role=alert so the message is announced when it appears. */}
                    <span class="admin-form-field__error" role="alert">{props.error}</span>
                </Show>
                <Show when={props.hint && !props.error}>
                    <span class="admin-form-field__hint">{props.hint}</span>
                </Show>
            </div>
        </div>
    );
};

export default FormField;
