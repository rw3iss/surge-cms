import { Component, For, } from 'solid-js';
import './RadioGroup.scss';

export interface RadioOption<T extends string = string,> {
    value: T;
    label: string;
    description?: string;
}

export interface RadioGroupProps<T extends string = string,> {
    name: string;
    value: T;
    onChange: (value: T,) => void;
    options: RadioOption<T>[];
    layout?: 'stacked' | 'inline';
}

export function RadioGroup<T extends string = string,>(
    props: RadioGroupProps<T>,
): ReturnType<Component> {
    return (
        <div class={`ui-radio-group ui-radio-group--${props.layout ?? 'stacked'}`}>
            <For each={props.options}>
                {(opt,) => (
                    <label class={`ui-radio ${props.value === opt.value ? 'is-selected' : ''}`}>
                        <input
                            type="radio"
                            name={props.name}
                            value={opt.value}
                            checked={props.value === opt.value}
                            onChange={() => props.onChange(opt.value,)}
                        />
                        <span class="ui-radio__indicator" aria-hidden="true" />
                        <span class="ui-radio__body">
                            <span class="ui-radio__label">{opt.label}</span>
                            {opt.description && <span class="ui-radio__description">{opt.description}</span>}
                        </span>
                    </label>
                )}
            </For>
        </div>
    );
}

export default RadioGroup;
