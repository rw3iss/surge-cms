/**
 * "Change payout" — set (or credit) a contribution's payout amount. Also used
 * for a published contributed post that has no payout yet. Refused by the
 * server once the earning is paid.
 */
import { Component, createSignal, createEffect, Show, } from 'solid-js';
import ModalShell from '../common/ModalShell';
import { CommitInput, FormField, } from '../forms';
import { centsToDollarsInput, parseDollars, } from './money';

const ChangePayoutModal: Component<{
    open: boolean;
    title: string;
    /** Current amount (cents) — prefilled; the default payout for a post with none. */
    amountCents: number;
    currency: string;
    busy?: boolean;
    onSave: (amountCents: number,) => void;
    onClose: () => void;
}> = (props,) => {
    // The draft follows each keystroke (onDraft) so Save works without a blur first.
    const [draft, setDraft,] = createSignal(centsToDollarsInput(props.amountCents,),);
    createEffect(() => { if (props.open) setDraft(centsToDollarsInput(props.amountCents,),); },);
    const cents = () => parseDollars(draft(),);

    return (
        <ModalShell open={props.open} onClose={props.onClose} size="sm" showClose ariaLabel="Change payout">
            <div class="contribution-payout-modal">
                <h3>Payout for “{props.title}”</h3>
                <FormField label={`Amount (${props.currency.toUpperCase()})`} hint="Credited to the contributor's partner balance; paid out with their next payout.">
                    <CommitInput
                        value={draft()}
                        onDraft={setDraft}
                        onCommit={setDraft}
                        validate={(v,) => (parseDollars(v,) === null ? 'Enter an amount, e.g. 40 or 40.00.' : null)}
                        placeholder="40.00"
                    />
                </FormField>
                <div class="contribution-payout-modal__actions">
                    <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose} disabled={props.busy}>Cancel</button>
                    <button
                        type="button"
                        class="ui-button ui-button--primary"
                        disabled={props.busy || cents() === null}
                        onClick={() => { const c = cents(); if (c !== null) props.onSave(c,); }}
                    >
                        <Show when={!props.busy} fallback="Saving…">Save payout</Show>
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default ChangePayoutModal;
