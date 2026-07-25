/**
 * Printify sync bar — shown on the admin Shop → Products page when the Printify
 * plugin is active OR any Printify products exist. Shows last-sync time +
 * product count and a "Sync from Printify" button that pulls the latest catalog.
 */
import { Component, createResource, createSignal, onMount, Show, } from 'solid-js';
import { A, } from '@solidjs/router';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';
import { isPluginEnabled, loadEnabledPlugins, } from '../../../stores/plugins';

const PrintifySyncBar: Component<{ onSynced?: () => void; }> = (props,) => {
    const toast = useToast();
    const [status, { refetch, },] = createResource(() => cms.shop.printify.status());
    const [busy, setBusy,] = createSignal(false,);

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
                <button class="btn btn--primary btn--small" onClick={sync} disabled={busy()}>
                    {busy() ? 'Syncing…' : 'Sync from Printify'}
                </button>

                <Show when={(status()?.needsAttentionCount ?? 0) > 0}>
                    {(() => {
                        const n = () => status()!.needsAttentionCount!;
                        return (
                            <div class="printify-bar__attention" role="status">
                                <span class="printify-bar__attention-text">
                                    ⚠ <strong>{n()}</strong> paid order{n() === 1 ? '' : 's'} awaiting Printify
                                    fulfillment. This usually means your Printify account needs a valid payment
                                    method — orders are held until production can be charged. The system retries
                                    automatically once it's resolved.
                                </span>
                                <span class="printify-bar__attention-links">
                                    <a
                                        href="https://printify.com/app/orders"
                                        target="_blank"
                                        rel="noopener"
                                        class="table-link"
                                    >
                                        Open Printify ↗
                                    </a>
                                    <A href="/admin/shop/orders" class="table-link">Review orders</A>
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
