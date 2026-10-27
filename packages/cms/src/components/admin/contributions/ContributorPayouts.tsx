/**
 * Posts → Contributions → Payouts: every contributor's balance (holding,
 * payable, paid) and Stripe status, with row selection to pay some — or pay
 * everyone with a payable balance. Each result (paid / amount / why not) is
 * listed under the table.
 */
import type { ContributionPayoutsResponse, ContributorBalance, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import { Checkbox, } from '../../ui/Checkbox';
import ConfirmModal from '../common/ConfirmModal';
import { useToast, } from '../../common/toast';
import { cms, } from '../../../services/cmsClient';
import { formatMoney, } from './money';

const ContributorPayouts: Component<{
    contributors: ContributorBalance[];
    currency: string;
    /** Author filter: clicking a name shows only their contributions above. */
    onFilterAuthor: (userId: string,) => void;
    onPaid: () => void;
}> = (props,) => {
    const toast = useToast();
    const [selected, setSelected,] = createSignal<Set<string>>(new Set(),);
    const [confirmAll, setConfirmAll,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [results, setResults,] = createSignal<ContributionPayoutsResponse['results']>([],);

    const toggle = (id: string, on: boolean,) => {
        const next = new Set(selected(),);
        if (on) next.add(id,); else next.delete(id,);
        setSelected(next,);
    };
    const allSelected = () => props.contributors.length > 0 && props.contributors.every((c,) => selected().has(c.userId,),);
    const toggleAll = (on: boolean,) => setSelected(on ? new Set(props.contributors.map((c,) => c.userId,),) : new Set<string>(),);
    const payableTotal = () => props.contributors.reduce((t, c,) => t + c.availableCents, 0,);

    const pay = async (userIds?: string[],) => {
        setBusy(true,);
        try {
            const r = await cms.contributions.payOut(userIds,);
            setResults(r.results,);
            const paid = r.results.filter((x,) => x.paid,);
            if (!r.results.length) toast.info('Nobody has a payable balance with a connected Stripe account.',);
            else if (paid.length === r.results.length) toast.success(`Paid ${paid.length} contributor${paid.length === 1 ? '' : 's'}.`,);
            else toast.info(`Paid ${paid.length} of ${r.results.length} — see the results below.`,);
            setSelected(new Set<string>(),);
            props.onPaid();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The payout failed.',);
        } finally {
            setBusy(false,);
            setConfirmAll(false,);
        }
    };

    return (
        <section class="admin-section contribution-payouts">
            <header class="admin-section__header">
                <h2>Payouts</h2>
                <p class="form-help-muted">
                    Earnings become payable after the holding period. A payout transfers a contributor's payable balance to their connected
                    Stripe account; contributors who have not finished connecting Stripe are skipped.
                </p>
            </header>
            <Show when={props.contributors.length} fallback={<p class="form-help-muted">No contributors yet.</p>}>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: '40px', }}><Checkbox checked={allSelected()} onChange={toggleAll} /></th>
                                <th>Contributor</th>
                                <th>Approved</th>
                                <th>Holding</th>
                                <th>Payable</th>
                                <th>Paid</th>
                                <th>Stripe</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={props.contributors}>
                                {(c,) => (
                                    <tr>
                                        <td><Checkbox checked={selected().has(c.userId,)} onChange={(v,) => toggle(c.userId, v,)} /></td>
                                        <td>
                                            <button type="button" class="contributions__author-link" onClick={() => props.onFilterAuthor(c.userId,)}>
                                                {c.name || c.email}
                                            </button>
                                            <div class="form-help-muted contributions__sub">{c.email}</div>
                                        </td>
                                        <td>{c.approvedCount}<Show when={c.pendingReviewCount}><span class="form-help-muted"> · {c.pendingReviewCount} waiting</span></Show></td>
                                        <td>{formatMoney(c.pendingCents, props.currency,)}</td>
                                        <td><strong>{formatMoney(c.availableCents, props.currency,)}</strong></td>
                                        <td>{formatMoney(c.paidCents, props.currency,)}</td>
                                        <td>
                                            <span class={`badge ${c.stripe.payoutsEnabled ? 'badge--success' : c.stripe.connected ? 'badge--warning' : 'badge--muted'}`}>
                                                {c.stripe.payoutsEnabled ? 'Ready' : c.stripe.connected ? 'Not finished' : 'Not connected'}
                                            </span>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
                <div class="contribution-payouts__actions">
                    <span class="form-help-muted">Payable now: <strong>{formatMoney(payableTotal(), props.currency,)}</strong></span>
                    <button
                        type="button"
                        class="ui-button ui-button--secondary"
                        disabled={busy() || selected().size === 0}
                        onClick={() => void pay([...selected(),],)}
                    >
                        {busy() ? 'Paying…' : `Pay selected (${selected().size})`}
                    </button>
                    <button type="button" class="ui-button ui-button--primary" disabled={busy() || payableTotal() <= 0} onClick={() => setConfirmAll(true,)}>
                        Pay everyone payable
                    </button>
                </div>
            </Show>

            <Show when={results().length}>
                <ul class="contribution-payouts__results">
                    <For each={results()}>
                        {(r,) => (
                            <li class={r.paid ? 'is-paid' : 'is-skipped'}>
                                <strong>{r.name}</strong> — {r.paid ? `paid ${formatMoney(r.amountCents, props.currency,)}` : r.message}
                            </li>
                        )}
                    </For>
                </ul>
            </Show>

            <ConfirmModal
                open={confirmAll()}
                title="Pay every contributor?"
                message={`This transfers ${formatMoney(payableTotal(), props.currency,)} — every contributor's payable balance — to their connected Stripe accounts.`}
                confirmLabel="Pay everyone"
                busyLabel="Paying…"
                loading={busy()}
                onConfirm={() => void pay()}
                onCancel={() => setConfirmAll(false,)}
            />
        </section>
    );
};

export default ContributorPayouts;
