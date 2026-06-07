/**
 * FormCheck — single checkbox with consistent label typography and an
 * optional inline tooltip. Use it anywhere a boolean toggle needs the
 * standard small-bold-label treatment.
 */
import { Component, JSX, Show, } from 'solid-js';
import Tooltip from '../common/Tooltip';

export interface FormCheckProps {
    label: string;
    checked: boolean;
    onChange: (next: boolean,) => void;
    tooltip?: string | JSX.Element;
    tooltipHeader?: string;
    /** Use a less prominent `font-weight: 500` style — for inline lists
     *  of toggles where multiple checkboxes share a section header
     *  (e.g. "Show fields"). Default is the standard semibold form label. */
    plain?: boolean;
    class?: string;
}

const FormCheck: Component<FormCheckProps> = (props,) => {
    return (
        <label class={`admin-form-check ${props.plain ? 'admin-form-check--plain' : ''} ${props.class || ''}`}>
            <input
                type="checkbox"
                checked={props.checked}
                onChange={(e,) => props.onChange(e.currentTarget.checked,)}
            />
            <span class="admin-form-check__label">
                <span>{props.label}</span>
                <Show when={props.tooltip}>
                    <Tooltip header={props.tooltipHeader || props.label} content={props.tooltip!} />
                </Show>
            </span>
        </label>
    );
};

export default FormCheck;
