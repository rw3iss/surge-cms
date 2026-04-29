import { Component, JSX, } from 'solid-js';
import './Checkbox.scss';

export interface CheckboxProps {
    checked: boolean;
    onChange: (checked: boolean,) => void;
    label?: JSX.Element;
    disabled?: boolean;
}

export const Checkbox: Component<CheckboxProps> = (props,) => {
    return (
        <label class={`ui-checkbox ${props.checked ? 'is-checked' : ''} ${props.disabled ? 'is-disabled' : ''}`}>
            <input
                type="checkbox"
                checked={props.checked}
                disabled={props.disabled}
                onChange={(e,) => props.onChange((e.currentTarget as HTMLInputElement).checked,)}
            />
            <span class="ui-checkbox__indicator" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="12" height="12">
                    <path d="M3 8l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </span>
            {props.label && <span class="ui-checkbox__label">{props.label}</span>}
        </label>
    );
};

export default Checkbox;
