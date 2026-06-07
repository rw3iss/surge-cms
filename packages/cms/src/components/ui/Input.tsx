import { Component, JSX, Show, splitProps, } from 'solid-js';
import './Input.scss';

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
    /** Visual size; matches Button's scale. */
    sizeVariant?: 'sm' | 'md' | 'lg';
    prefix?: JSX.Element;
    suffix?: JSX.Element;
    /** Lifts the value into a controlled signal pattern: pass `value` and `onValueChange`. */
    onValueChange?: (value: string,) => void;
    invalid?: boolean;
}

export const Input: Component<InputProps> = (props,) => {
    const [own, rest,] = splitProps(props, [
        'sizeVariant',
        'prefix',
        'suffix',
        'onValueChange',
        'invalid',
        'class',
        'type',
    ],);

    const wrapperClass = () =>
        [
            'ui-input-wrapper',
            `ui-input-wrapper--${own.sizeVariant ?? 'md'}`,
            own.invalid ? 'is-invalid' : '',
        ].filter(Boolean,).join(' ',);

    return (
        <div class={wrapperClass()}>
            <Show when={own.prefix}>
                <span class="ui-input__affix ui-input__affix--prefix">{own.prefix}</span>
            </Show>
            <input
                type={own.type ?? 'text'}
                class={`ui-input ${own.class ?? ''}`}
                onInput={(e,) => own.onValueChange?.((e.currentTarget as HTMLInputElement).value,)}
                {...rest}
            />
            <Show when={own.suffix}>
                <span class="ui-input__affix ui-input__affix--suffix">{own.suffix}</span>
            </Show>
        </div>
    );
};

export default Input;
