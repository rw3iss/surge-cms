/**
 * Printify sync bar — shown on the admin Shop → Products page when the Printify
 * plugin is active OR any Printify products exist. Shows last-sync time +
 * product count and a "Sync from Printify" button that pulls the latest catalog.
 */
import { Component, createResource, createSignal, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useToast, } from '../../../components/common/toast';

const PrintifySyncBar: Component<{ onSynced?: () => void; }> = (props,) => {
    const toast = useToast();
    const [status, { refetch, },] = createResource(() => cms.shop.printify.status());
    const [busy, setBusy,] = createSignal(false,);

    const visible = () => {
        const s = status();
        return !!s && (s.active || s.productCount > 0);
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
            </div>
        </Show>
    );
};

export default PrintifySyncBar;
