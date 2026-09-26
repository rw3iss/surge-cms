/**
 * Sign in without leaving the page.
 *
 * The same form as `/login` (`LoginForm`), in an overlay. On success it just
 * closes: `auth.login` has already updated the app-wide user, so whatever the
 * visitor was looking at — an event's registration form, say — re-renders in
 * its signed-in state in place, with no navigation and no reload.
 */
import type { User, } from '@sitesurge/types';
import { Component, onCleanup, onMount, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import LoginForm from './LoginForm';
import './LoginModal.scss';

export interface LoginModalProps {
    onClose: () => void;
    /** Called after a successful sign-in, before the modal closes. */
    onSuccess?: (user: User | null,) => void;
    title?: string;
}

const LoginModal: Component<LoginModalProps> = (props,) => {
    const onKey = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') props.onClose();
    };
    onMount(() => document.addEventListener('keydown', onKey,));
    onCleanup(() => document.removeEventListener('keydown', onKey,));

    return (
        <Portal>
            <div
                class="login-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="login-modal-title"
                onClick={(e,) => {
                    if (e.target === e.currentTarget) props.onClose();
                }}
            >
                <div class="login-modal login__container">
                    <button type="button" class="login-modal__close" aria-label="Close" onClick={props.onClose}>
                        ×
                    </button>
                    <h2 id="login-modal-title" class="login__title">{props.title ?? 'Sign In'}</h2>
                    <LoginForm
                        idPrefix="login-modal"
                        onSuccess={(user,) => {
                            props.onSuccess?.(user,);
                            props.onClose();
                        }}
                    />
                </div>
            </div>
        </Portal>
    );
};

export default LoginModal;
