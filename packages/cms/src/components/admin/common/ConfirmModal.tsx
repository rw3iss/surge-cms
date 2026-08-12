import { type JSX, Show, } from 'solid-js';
import ModalShell from './ModalShell';

interface ConfirmModalProps {
    open: boolean;
    title: string;
    /** Plain confirmation text. Optional — pass `children` for a richer body
     *  (e.g. a type-to-confirm input or a warning list). */
    message?: string;
    /** Custom body content, rendered below `message`. Lets callers reuse this
     *  dialog for confirmations that need more than a sentence. */
    children?: JSX.Element;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Label shown on the confirm button while `loading` (default "Working…"). */
    busyLabel?: string;
    /** Disables both buttons + shows `busyLabel` — for async confirms in flight. */
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
}

/**
 * The canonical confirmation dialog (built on `ModalShell`). Backward-compatible:
 * pass `message` for the common case; `children` + `loading`/`busyLabel` unlock
 * richer, async confirmations so hand-rolled `confirm-modal` markup can migrate here.
 */
export default function ConfirmModal(props: ConfirmModalProps,) {
    return (
        <ModalShell open={props.open} onClose={props.onCancel} size="sm" ariaLabel={props.title}>
            <div class="confirm-modal">
                <h3 class="confirm-modal__title">{props.title}</h3>
                <Show when={props.message}>
                    <p class="confirm-modal__message">{props.message}</p>
                </Show>
                {props.children}
                <div class="confirm-modal__actions">
                    <button class="btn btn--secondary" onClick={props.onCancel} disabled={props.loading}>
                        {props.cancelLabel || 'Cancel'}
                    </button>
                    <button
                        class={`btn ${props.danger ? 'btn--danger' : 'btn--primary'}`}
                        onClick={props.onConfirm}
                        disabled={props.loading}
                    >
                        {props.loading ? (props.busyLabel || 'Working…') : (props.confirmLabel || 'Confirm')}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
