import ModalShell from './ModalShell';

interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
}

export default function ConfirmModal(props: ConfirmModalProps,) {
    return (
        <ModalShell open={props.open} onClose={props.onCancel} size="sm" ariaLabel={props.title}>
            <div class="confirm-modal">
                <h3 class="confirm-modal__title">{props.title}</h3>
                <p class="confirm-modal__message">{props.message}</p>
                <div class="confirm-modal__actions">
                    <button class="btn btn--secondary" onClick={props.onCancel}>
                        {props.cancelLabel || 'Cancel'}
                    </button>
                    <button
                        class={`btn ${props.danger ? 'btn--danger' : 'btn--primary'}`}
                        onClick={props.onConfirm}
                    >
                        {props.confirmLabel || 'Confirm'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
