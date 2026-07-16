import { Component, JSX, Show, onCleanup, onMount, } from 'solid-js';
import { Portal, } from 'solid-js/web';

export interface ModalShellProps {
    /** Controls mount/visibility. */
    open: boolean;
    /** Fired on backdrop click, Escape, or the ✕ button. */
    onClose: () => void;
    children: JSX.Element;
    /** Panel width preset. Default 'sm'. */
    size?: 'sm' | 'md' | 'lg' | 'full';
    /** Render the ✕ close button in the panel's top-right. Default false. */
    showClose?: boolean;
    /** Dismiss when the backdrop is clicked. Default true. */
    dismissOnBackdrop?: boolean;
    /** Dismiss on Escape. Default true. */
    dismissOnEscape?: boolean;
    /** Extra class on the panel (keep call-site inner classes working). */
    class?: string;
    /** Accessible label for the dialog. */
    ariaLabel?: string;
}

const ModalShell: Component<ModalShellProps> = (props,) => {
    const size = () => props.size ?? 'sm';
    const backdropDismiss = () => props.dismissOnBackdrop !== false;
    const escapeDismiss = () => props.dismissOnEscape !== false;

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape' && props.open && escapeDismiss()) {
            e.stopPropagation();
            props.onClose();
        }
    };
    onMount(() => document.addEventListener('keydown', onKeyDown,),);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown,),);

    return (
        <Show when={props.open}>
            <Portal>
                <div
                    class="modal-shell-overlay"
                    onClick={(e,) => {
                        if (backdropDismiss() && e.target === e.currentTarget) props.onClose();
                    }}
                >
                    <div
                        class={`modal-shell modal-shell--${size()} ${props.class ?? ''}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={props.ariaLabel}
                        onClick={(e,) => e.stopPropagation()}
                    >
                        <Show when={props.showClose}>
                            <button
                                type="button"
                                class="modal-close"
                                aria-label="Close"
                                onClick={props.onClose}
                            >
                                &times;
                            </button>
                        </Show>
                        {props.children}
                    </div>
                </div>
            </Portal>
        </Show>
    );
};

export default ModalShell;
