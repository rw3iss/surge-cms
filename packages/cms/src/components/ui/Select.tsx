import { Component, JSX, splitProps, } from 'solid-js';
import './Select.scss';

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export interface SelectProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
    sizeVariant?: 'sm' | 'md' | 'lg';
    options: SelectOption[];
    onValueChange?: (value: string,) => void;
    invalid?: boolean;
}

export const Select: Component<SelectProps> = (props,) => {
    const [own, rest,] = splitProps(props, ['sizeVariant', 'options', 'onValueChange', 'invalid', 'class',],);

    return (
        <select
            class={[
                'ui-select',
                `ui-select--${own.sizeVariant ?? 'md'}`,
                own.invalid ? 'is-invalid' : '',
                own.class ?? '',
            ].filter(Boolean,).join(' ',)}
            onChange={(e,) => own.onValueChange?.((e.currentTarget as HTMLSelectElement).value,)}
            {...rest}
        >
            {own.options.map((opt,) => (
                <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
            ),)}
        </select>
    );
};

export default Select;
