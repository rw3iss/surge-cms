import { Component, } from 'solid-js';
import './Spinner.scss';

export interface SpinnerProps {
    size?: number;
    label?: string;
}

export const Spinner: Component<SpinnerProps> = (props,) => {
    const size = () => props.size ?? 18;
    return (
        <span class="ui-spinner" role={props.label ? 'status' : undefined} aria-label={props.label}>
            <span
                class="ui-spinner__circle"
                style={{ width: `${size()}px`, height: `${size()}px`, }}
            />
            {props.label && <span class="ui-spinner__label">{props.label}</span>}
        </span>
    );
};

export default Spinner;
