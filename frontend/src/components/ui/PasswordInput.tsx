import { Component, createSignal, splitProps, } from 'solid-js';
import { Input, type InputProps, } from './Input';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'suffix'> {}

/**
 * Password field with a show/hide eye toggle. The toggle is a `<button>`
 * (focusable, keyboard-accessible) rather than a div so screen readers
 * announce its state.
 */
export const PasswordInput: Component<PasswordInputProps> = (props,) => {
    const [visible, setVisible,] = createSignal(false,);
    const [own, rest,] = splitProps(props, ['class',],);

    return (
        <Input
            type={visible() ? 'text' : 'password'}
            class={own.class}
            suffix={
                <button
                    type="button"
                    class="ui-password-toggle"
                    onClick={() => setVisible(!visible(),)}
                    aria-label={visible() ? 'Hide password' : 'Show password'}
                    tabindex={-1}
                >
                    {visible() ? '🙈' : '👁'}
                </button>
            }
            {...rest}
        />
    );
};

export default PasswordInput;
