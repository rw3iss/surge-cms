/**
 * A table of discount codes — shared by Shop → Discount codes and each
 * affiliate on Shop → Affiliates: code, discount, uses / max, limits, an
 * Active switch, Edit and Delete.
 */
import type { ShopDiscountCode, } from '@sitesurge/types';
import { discountSummary, formatPercent, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../common/toast';
import ConfirmModal from '../common/ConfirmModal';
import Toggle from '../common/Toggle';
import './discounts.scss';

const dateOnly = (iso: string | null,) => (iso ? new Date(iso,).toLocaleDateString(undefined, { dateStyle: 'medium', },) : '');

/** What a code gives (and, for an affiliate code, earns). */
export function codeDescription(c: ShopDiscountCode, currency = 'usd',): string {
    const rule = { kind: c.kind, percent: c.percent, amountCents: c.amountCents, appliesToTickets: c.appliesToTickets, };
    if (c.affiliateUserId) {
        const earn = Math.max(0, (c.commissionPercent ?? 0) - c.percent,);
        return `${formatPercent(c.commissionPercent ?? 0,)}% commission`
            + (c.percent > 0 ? ` · buyers get ${formatPercent(c.percent,)}% off (affiliate keeps ${formatPercent(earn,)}%)` : '');
    }
    return discountSummary(rule, currency,);
}

/** Window + who-may-use limits as short text. */
function limits(c: ShopDiscountCode,): string {
    const parts: string[] = [];
    if (c.startsAt) parts.push(`from ${dateOnly(c.startsAt,)}`,);
    if (c.endsAt) parts.push(`until ${dateOnly(c.endsAt,)}`,);
    if (c.minSubtotalCents) parts.push(`min $${(c.minSubtotalCents / 100).toFixed(2,)}`,);
    if (c.allowedTierIds.length || c.allowedRoles.length) parts.push('members only',);
    if (c.maxUsesPerUser) parts.push(`${c.maxUsesPerUser} per buyer`,);
    if (c.appliesToTickets && c.affiliateUserId) parts.push('incl. tickets',);
    return parts.join(' · ',) || '—';
}

const DiscountCodeTable: Component<{
    codes: ShopDiscountCode[];
    onEdit: (c: ShopDiscountCode,) => void;
    onChanged: () => void;
    emptyText?: string;
}> = (props,) => {
    const toast = useToast();
    const [deleting, setDeleting,] = createSignal<ShopDiscountCode | null>(null,);
    const [busy, setBusy,] = createSignal(false,);

    const setActive = async (c: ShopDiscountCode, active: boolean,) => {
        try {
            await cms.shop.discounts.update(c.id, { active, },);
            props.onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not update the code.',);
        }
    };
    const remove = async () => {
        const c = deleting();
        if (!c) return;
        setBusy(true,);
        try {
            await cms.shop.discounts.remove(c.id,);
            toast.success(`Deleted ${c.code}.`,);
            props.onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not delete the code.',);
        } finally {
            setBusy(false,);
            setDeleting(null,);
        }
    };

    return (
        <>
            <Show when={props.codes.length} fallback={<p class="form-help-muted">{props.emptyText ?? 'No codes yet.'}</p>}>
                <div class="admin-table-container">
                    <table class="admin-table discount-table">
                        <thead>
                            <tr><th>Code</th><th>Discount</th><th>Used</th><th>Limits</th><th>Active</th><th /></tr>
                        </thead>
                        <tbody>
                            <For each={props.codes}>
                                {(c,) => (
                                    <tr classList={{ 'discount-table__row--off': !c.active, }}>
                                        <td><code class="discount-table__code">{c.code}</code></td>
                                        <td>{codeDescription(c,)}</td>
                                        <td title="Paid orders that used the code (refunds excluded)">
                                            {c.uses}{c.maxUses != null ? ` / ${c.maxUses}` : ''}
                                        </td>
                                        <td class="form-help-muted">{limits(c,)}</td>
                                        <td><Toggle checked={c.active} onChange={(v,) => void setActive(c, v,)} ariaLabel={`${c.code} active`} size="sm" /></td>
                                        <td class="discount-table__actions">
                                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => props.onEdit(c,)}>Edit</button>{' '}
                                            <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setDeleting(c,)}>Delete</button>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
            <ConfirmModal
                open={deleting() !== null}
                title={`Delete ${deleting()?.code ?? 'code'}?`}
                message="Buyers can no longer use it. Orders that used it keep their discount and history."
                confirmLabel="Delete"
                busyLabel="Deleting…"
                loading={busy()}
                danger
                onConfirm={() => void remove()}
                onCancel={() => setDeleting(null,)}
            />
        </>
    );
};

export default DiscountCodeTable;
