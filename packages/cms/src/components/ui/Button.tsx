import { Component, JSX, splitProps, } from 'solid-js';
import './Button.scss';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    block?: boolean;
    type?: 'button' | 'submit' | 'reset';
    leadingIcon?: JSX.Element;
    trailingIcon?: JSX.Element;
}

/**
 * Generic button. The variants and sizes are intentionally limited to
 * keep visual design coherent across the app. Add a new variant only
 * when an existing one truly doesn't fit.
 */
export const Button: Component<ButtonProps> = (props,) => {
    const [own, rest,] = splitProps(props, [
        'variant',
        'size',
        'loading',
        'block',
        'leadingIcon',
        'trailingIcon',
        'children',
        'class',
        'type',
        'disabled',
    ],);

    const klass = () =>
        [
            'ui-button',
            `ui-button--${own.variant ?? 'primary'}`,
            `ui-button--${own.size ?? 'md'}`,
            own.block ? 'ui-button--block' : '',
            own.loading ? 'is-loading' : '',
            own.class ?? '',
        ].filter(Boolean,).join(' ',);

    return (
        <button
            type={own.type ?? 'button'}
            class={klass()}
            disabled={own.disabled || own.loading}
            {...rest}
        >
            {own.leadingIcon && <span class="ui-button__icon ui-button__icon--leading">{own.leadingIcon}</span>}
            <span class="ui-button__label">{own.children}</span>
            {own.trailingIcon && <span class="ui-button__icon ui-button__icon--trailing">{own.trailingIcon}</span>}
            {own.loading && <span class="ui-button__spinner" aria-hidden="true" />}
        </button>
    );
};

export default Button;
