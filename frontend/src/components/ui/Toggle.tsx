import { Component, JSX, } from 'solid-js';
import './Toggle.scss';

export interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean,) => void;
    label?: JSX.Element;
    disabled?: boolean;
    size?: 'sm' | 'md';
    /** When true, the visual style emphasizes the toggle as a section header pill. */
    emphasis?: boolean;
}

/**
 * Switch / toggle. Used both inline (next to a label) and inside
 * `FormSection` headers to "enable this section". The whole control is
 * a button so screen readers report `role="switch"` correctly.
 */
export const Toggle: Component<ToggleProps> = (props,) => {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={props.checked}
            disabled={props.disabled}
            class={[
                'ui-toggle',
                `ui-toggle--${props.size ?? 'md'}`,
                props.checked ? 'is-checked' : '',
                props.emphasis ? 'ui-toggle--emphasis' : '',
            ].filter(Boolean,).join(' ',)}
            onClick={() => props.onChange(!props.checked,)}
        >
            <span class="ui-toggle__track">
                <span class="ui-toggle__thumb" />
            </span>
            {props.label && <span class="ui-toggle__label">{props.label}</span>}
        </button>
    );
};

export default Toggle;
