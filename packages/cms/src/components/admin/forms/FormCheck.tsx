/**
 * FormCheck — a single boolean with consistent label typography and an optional
 * inline tooltip.
 *
 * Renders the project-wide `Toggle` SWITCH, not a checkbox (ADMIN_STYLES.md:
 * every boolean is a switch). The name and the props are unchanged so its 25
 * call sites did not have to move; what changed is the control it draws.
 */
import { Component, JSX, Show, } from 'solid-js';
import Tooltip from '../common/Tooltip';
import Toggle from '../common/Toggle';

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
        <span class={`admin-form-check ${props.plain ? 'admin-form-check--plain' : ''} ${props.class || ''}`}>
            <Toggle
                checked={props.checked}
                onChange={props.onChange}
                ariaLabel={props.label}
                label={
                    <span class="admin-form-check__label">
                        <span>{props.label}</span>
                        <Show when={props.tooltip}>
                            <Tooltip header={props.tooltipHeader || props.label} content={props.tooltip!} />
                        </Show>
                    </span>
                }
            />
        </span>
    );
};

export default FormCheck;
