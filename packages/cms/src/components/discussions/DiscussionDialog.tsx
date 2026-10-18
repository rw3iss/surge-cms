/**
 * Public confirm / report dialog for comments and forum threads — replaces
 * `window.confirm` / `window.prompt` (unstyled, blocked in some embedded
 * browsers). A Portal overlay; Escape or a click outside cancels.
 *
 * `reason` mode adds an optional textarea capped at `maxLength` with a live
 * character count (the server keeps the first 1000 characters of a report).
 */
import { Component, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';

export interface DiscussionDialogProps {
    title: string;
    message?: string;
    confirmLabel: string;
    /** Red confirm button (delete / hide). */
    danger?: boolean;
    /** Show an optional reason textarea. */
    reason?: boolean;
    reasonLabel?: string;
    maxLength?: number;
    onConfirm: (reason: string,) => void | Promise<void>;
    onCancel: () => void;
}

let dialogSeq = 0;

const DiscussionDialog: Component<DiscussionDialogProps> = (props,) => {
    const id = `discussion-dialog-${++dialogSeq}`;
    const max = () => props.maxLength ?? 1000;
    const [text, setText,] = createSignal('',);
    const [busy, setBusy,] = createSignal(false,);
    let confirmBtn: HTMLButtonElement | undefined;
    let area: HTMLTextAreaElement | undefined;

    const onKey = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') props.onCancel();
    };
    onMount(() => {
        document.addEventListener('keydown', onKey,);
        (area ?? confirmBtn)?.focus();
    },);
    onCleanup(() => document.removeEventListener('keydown', onKey,));

    const confirm = async () => {
        if (busy()) return;
        setBusy(true,);
        try {
            await props.onConfirm(text().trim(),);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <Portal>
            <div
                class="discussion-dialog-overlay"
                onClick={(e,) => { if (e.target === e.currentTarget) props.onCancel(); }}
            >
                <div class="discussion-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
                    <h2 id={`${id}-title`} class="discussion-dialog__title">{props.title}</h2>
                    <Show when={props.message}><p class="discussion-dialog__message">{props.message}</p></Show>
                    <Show when={props.reason}>
                        <label class="discussion-dialog__label" for={`${id}-reason`}>{props.reasonLabel ?? 'Reason (optional)'}</label>
                        <textarea
                            ref={area}
                            id={`${id}-reason`}
                            class="discussion-dialog__reason"
                            rows={4}
                            maxLength={max()}
                            value={text()}
                            // Local draft only — nothing lifts until Confirm.
                            onInput={(e,) => setText(e.currentTarget.value,)}
                        />
                        <span class="discussion-dialog__count" aria-live="off">{text().length} / {max()}</span>
                    </Show>
                    <div class="discussion-dialog__actions">
                        <button type="button" class="discussion-dialog__btn" onClick={props.onCancel} disabled={busy()}>Cancel</button>
                        <button
                            ref={confirmBtn}
                            type="button"
                            class={`discussion-dialog__btn ${props.danger ? 'discussion-dialog__btn--danger' : 'discussion-dialog__btn--primary'}`}
                            onClick={() => void confirm()}
                            disabled={busy()}
                        >
                            {busy() ? 'Working…' : props.confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default DiscussionDialog;
