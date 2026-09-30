/**
 * Manage one recurring donation: change the amount or frequency, or cancel it.
 *
 * Everything goes through our API, which edits the Stripe subscription — the
 * donor never needs the Stripe dashboard. A change applies from the NEXT
 * charge (the server keeps the date they were already due to pay), so saving
 * never charges them on the spot. Both actions ask for confirmation first.
 */
import type { RecurringDonation, } from '@sitesurge/types';
import { DONATION_INTERVALS, type DonationInterval, donationInterval, formatCurrency, } from '@sitesurge/types';
import { Component, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { cms, } from '../../services/cmsClient';
import './RecurringDonationModal.scss';

export interface RecurringDonationModalProps {
    donation: RecurringDonation;
    onClose: () => void;
    /** Called with the updated schedule after a save or a cancel. */
    onChanged: (d: RecurringDonation,) => void;
}

const fmtDate = (iso: string | null,) =>
    iso ? new Date(iso,).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', },) : '—';

const RecurringDonationModal: Component<RecurringDonationModalProps> = (props,) => {
    const d = () => props.donation;
    const [amount, setAmount,] = createSignal((d().amountCents / 100).toFixed(2,),);
    const [interval, setInterval_,] = createSignal<DonationInterval>(d().interval ?? 'monthly',);
    const [confirming, setConfirming,] = createSignal<'save' | 'cancel' | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const cents = () => Math.round(parseFloat(amount(),) * 100,);
    const changed = () => cents() !== d().amountCents || interval() !== d().interval;
    const label = (v: DonationInterval | null,) => (donationInterval(v,)?.label ?? 'Recurring').toLowerCase();

    const close = () => {
        if (!busy()) props.onClose();
    };
    const onKey = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') close();
    };
    onMount(() => document.addEventListener('keydown', onKey,));
    onCleanup(() => document.removeEventListener('keydown', onKey,));

    const askSave = () => {
        setError('',);
        if (!Number.isFinite(cents(),) || cents() < 100) {
            setError('The minimum donation is $1.00.',);
            return;
        }
        setConfirming('save',);
    };

    const run = async (action: 'save' | 'cancel',) => {
        setBusy(true,);
        setError('',);
        try {
            const next = action === 'save' ?
                await cms.payments.updateRecurringDonation(d().id, { amountCents: cents(), interval: interval(), },) :
                await cms.payments.cancelRecurringDonation(d().id,);
            props.onChanged(next,);
            props.onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.',);
            setConfirming(null,);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <Portal>
            <div
                class="recurring-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="recurring-modal-title"
                onClick={(e,) => {
                    if (e.target === e.currentTarget) close();
                }}
            >
                <div class="recurring-modal">
                    <button type="button" class="recurring-modal__close" aria-label="Close" onClick={close}>×</button>
                    <h2 id="recurring-modal-title">Manage recurring donation</h2>
                    <p class="recurring-modal__lede">
                        {d().campaignTitle || 'General donation'} — currently{' '}
                        <strong>{formatCurrency(d().amountCents, d().currency,)} {label(d().interval,)}</strong>.
                        <Show when={d().nextPaymentAt}>{' '}Next payment {fmtDate(d().nextPaymentAt,)}.</Show>
                    </p>

                    <Show
                        when={!confirming()}
                        fallback={
                            <div class="recurring-modal__confirm">
                                <Show
                                    when={confirming() === 'save'}
                                    fallback={
                                        <p>
                                            Cancel this recurring donation? No further payments will be taken. Your past
                                            donations stay on record.
                                        </p>
                                    }
                                >
                                    <p>
                                        Change to <strong>{formatCurrency(cents(), d().currency,)} {label(interval(),)}</strong>?
                                        It takes effect from your next payment
                                        <Show when={d().nextPaymentAt}>{' '}({fmtDate(d().nextPaymentAt,)})</Show>; you won't
                                        be charged today.
                                    </p>
                                </Show>
                                <div class="recurring-modal__actions">
                                    <button type="button" class="btn btn--outline" disabled={busy()} onClick={() => setConfirming(null,)}>
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        class={`btn ${confirming() === 'cancel' ? 'btn--danger recurring-modal__danger' : 'btn--primary'}`}
                                        disabled={busy()}
                                        onClick={() => run(confirming()!,)}
                                    >
                                        {busy() ? 'Working…' : confirming() === 'cancel' ? 'Yes, cancel it' : 'Yes, change it'}
                                    </button>
                                </div>
                            </div>
                        }
                    >
                        <div class="recurring-modal__fields">
                            <label>
                                <span>Amount</span>
                                <div class="recurring-modal__amount">
                                    <span>$</span>
                                    <input
                                        type="number"
                                        min="1"
                                        step="0.01"
                                        value={amount()}
                                        onInput={(e,) => setAmount(e.currentTarget.value,)}
                                    />
                                </div>
                            </label>
                            <label>
                                <span>Frequency</span>
                                <select
                                    value={interval()}
                                    onChange={(e,) => setInterval_(e.currentTarget.value as DonationInterval,)}
                                >
                                    {DONATION_INTERVALS.map((i,) => <option value={i.value}>{i.label}</option>)}
                                </select>
                            </label>
                        </div>
                        <div class="recurring-modal__actions">
                            <button
                                type="button"
                                class="recurring-modal__cancel-link"
                                onClick={() => setConfirming('cancel',)}
                            >
                                Cancel recurring donation
                            </button>
                            <button type="button" class="btn btn--primary" disabled={!changed()} onClick={askSave}>
                                Save changes
                            </button>
                        </div>
                    </Show>

                    <Show when={error()}>
                        <p class="recurring-modal__error">{error()}</p>
                    </Show>
                </div>
            </div>
        </Portal>
    );
};

export default RecurringDonationModal;
