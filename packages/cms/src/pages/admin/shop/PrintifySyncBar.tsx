/**
 * Printify sync bar — shown on the admin Shop dashboard + Products page when the
 * Printify plugin is active OR any Printify products exist. Shows last-sync time
 * + product count and a "Sync from Printify" button that pulls the latest
 * catalogue AND reconciles orders (status + tracking) with Printify.
 */
import { Component, createResource, createSignal, onMount, Show, } from 'solid-js';
import { A, } from '@solidjs/router';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';
import { isPluginEnabled, loadEnabledPlugins, } from '../../../stores/plugins';
import type { ShopProviderOrderReconcileResult, } from '@sitesurge/types';

const STATUS_WORDS: Record<string, string> = {
    delivered: 'delivered',
    shipped: 'shipped',
    partially_shipped: 'partly shipped',
    in_production: 'in production',
    pending: 'awaiting production',
    on_hold: 'on hold',
    cancelled: 'cancelled',
};

/** "Updated 8 orders: 5 shipped, 3 delivered." (+ linked / held emails). */
function describeOrderReconcile(o: ShopProviderOrderReconcileResult,): string {
    if (!o.updated) return `Orders up to date (${o.matched} checked).`;
    const parts = Object.entries(o.statusCounts,)
        .sort((a, b,) => b[1] - a[1])
        .map(([k, n,],) => `${n} ${STATUS_WORDS[k] ?? k}`);
    let msg = `Updated ${o.updated} order${o.updated === 1 ? '' : 's'}: ${parts.join(', ',)}.`;
    if (o.linked) msg += ` ${o.linked} newly linked.`;
    const held = o.customerEmailsNotSent.length;
    if (held) msg += ` ${held} customer shipping email${held === 1 ? '' : 's'} not sent.`;
    return msg;
}

/** "2 not sent · 1 on hold · 1 cancelled by Printify" — the reasons, named apart. */
function attentionReasons(a: { notSent: number; onHold: number; stalled: number; cancelled: number; } | undefined,): string {
    if (!a) return '';
    return [
        a.notSent ? `${a.notSent} not sent to Printify` : '',
        a.onHold ? `${a.onHold} on hold at Printify` : '',
        a.stalled ? `${a.stalled} not in production after a day` : '',
        a.cancelled ? `${a.cancelled} cancelled by Printify (refund?)` : '',
    ].filter(Boolean,).join(' · ',);
}

const PrintifySyncBar: Component<{ onSynced?: () => void; }> = (props,) => {
    const toast = useToast();
    const [status, { refetch, },] = createResource(() => cms.shop.printify.status());
    const [busy, setBusy,] = createSignal(false,);
    const [fullBusy, setFullBusy,] = createSignal(false,);

    // A full year of orders runs in the background (it can outlast a request).
    const fullResync = async () => {
        setFullBusy(true,);
        try {
            const r = await cms.shop.printify.fullOrderResync();
            toast.success(`Full order resync started (last ${r.sinceDays} days) — status updates in a few minutes.`,);
        } catch (err: any) {
            toast.error(err?.message || 'Could not start the full resync',);
        } finally {
            setFullBusy(false,);
        }
    };

    // Refresh enabled-plugin state so the bar appears as soon as Printify is
    // enabled — even before the first sync (when productCount is still 0).
    onMount(() => { void loadEnabledPlugins(true,); },);

    const visible = () => {
        const s = status();
        return isPluginEnabled('printify',) || (!!s && (s.active || s.productCount > 0));
    };

    const sync = async () => {
        setBusy(true,);
        try {
            const r = await cms.shop.printify.sync();
            if (!r.ok && r.errors.length) {
                toast.error(`Printify sync: ${r.errors.length} error(s) — ${r.errors[0]}`,);
            } else {
                toast.success(`Printify synced: ${r.upserted} product(s), ${r.archived} archived.`,);
            }
            if (r.orders) {
                const o = r.orders;
                if (o.errors.length) toast.error(`Printify orders: ${o.errors.length} problem(s) — ${o.errors[0]}`,);
                toast.success(describeOrderReconcile(o,),);
            }
            await refetch();
            props.onSynced?.();
        } catch (err: any) {
            toast.error(err?.message || 'Printify sync failed',);
        } finally {
            setBusy(false,);
        }
    };

    return (
        <Show when={visible()}>
            <div class="printify-bar">
                <div class="printify-bar__info">
                    <span class="printify-bar__title">Printify</span>
                    <Show when={status()}>
                        {(s,) => (
                            <span class="printify-bar__meta">
                                {s().productCount} product{s().productCount === 1 ? '' : 's'} imported
                                {s().lastSyncedAt
                                    ? ` · last synced ${new Date(s().lastSyncedAt!,).toLocaleString()}`
                                    : ' · not synced yet'}
                                <Show when={!s().active}>
                                    <span class="printify-bar__warn">
                                        {' '}· plugin disabled/unconfigured — sync uses saved credentials
                                    </span>
                                </Show>
                            </span>
                        )}
                    </Show>
                </div>
                <button class="ui-button ui-button--primary ui-button--sm" onClick={sync} disabled={busy() || fullBusy()}>
                    {busy() ? 'Syncing…' : 'Sync from Printify'}
                </button>
                <button
                    class="ui-button ui-button--secondary ui-button--sm"
                    onClick={fullResync}
                    disabled={busy() || fullBusy()}
                    title="Sync from Printify checks the last 90 days of orders. This re-checks a full year, in the background."
                >
                    {fullBusy() ? 'Starting…' : 'Full order resync'}
                </button>

                <Show when={(status()?.needsAttentionCount ?? 0) > 0}>
                    {(() => {
                        const n = () => status()!.needsAttentionCount!;
                        return (
                            <div class="printify-bar__attention" role="status">
                                <span class="printify-bar__attention-text">
                                    ⚠ <strong>{n()}</strong> paid order{n() === 1 ? '' : 's'} need{n() === 1 ? 's' : ''} attention
                                    <Show when={attentionReasons(status()?.attention,)}>
                                        {(why,) => <> — {why()}</>}
                                    </Show>
                                    . Often your Printify account needs a valid payment method. The system
                                    retries automatically; Sync from Printify refreshes order status now.
                                </span>
                                <span class="printify-bar__attention-links">
                                    <a
                                        href={status()?.ordersUrl ?? 'https://printify.com/app/stores'}
                                        target="_blank"
                                        rel="noopener"
                                        class="table-link"
                                    >
                                        Open Printify ↗
                                    </a>
                                    <A href="/admin/shop/orders?attention=1" class="table-link">Review orders</A>
                                </span>
                            </div>
                        );
                    })()}
                </Show>
            </div>
        </Show>
    );
};

export default PrintifySyncBar;
