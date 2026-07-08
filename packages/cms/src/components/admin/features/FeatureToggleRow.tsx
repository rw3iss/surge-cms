/**
 * Single feature toggle row, dependency-aware. Used by Settings →
 * Features panel — one row per feature in `FEATURES`. Clicking the
 * switch either flips the feature immediately (no unresolved
 * dependencies) or opens the cascade-confirm modal.
 *
 * While an install/disable/remove operation is in flight the switch is
 * disabled and a spinner + status label ("Installing…" / "Removing…" /
 * "Updating…") is shown. When enabled, an optional "Remove…" text button
 * opens `FeatureRemoveModal` for a destructive uninstall (drops tables +
 * data). When disabled, a muted "Disabled — data preserved" hint is
 * shown so operators know their data is still recoverable.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { FeatureKey, getFeature, } from '../../../config/features';
import {
    isFeatureEnabled,
    getMissingPrerequisites,
    getEnabledDependents,
} from '../../../stores/siteSettings';
import FeatureDependencyModal from './FeatureDependencyModal';
import FeatureRemoveModal from './FeatureRemoveModal';

interface ChangeOpts { enableDependencies?: boolean; disableDependents?: boolean; }

interface Props {
    featureKey: FeatureKey;
    onChange: (next: boolean, opts?: ChangeOpts,) => void | Promise<void>;
    onRemove?: () => void | Promise<void>;
}

const FeatureToggleRow: Component<Props> = (p,) => {
    const cfg = () => getFeature(p.featureKey,);
    const enabled = () => isFeatureEnabled(p.featureKey,);
    const missing = () => getMissingPrerequisites(p.featureKey,);
    const dependents = () => getEnabledDependents(p.featureKey,);

    const [modal, setModal,] = createSignal<'enable' | 'disable' | 'remove' | null>(null,);
    const [busy, setBusy,] = createSignal(false,);
    // What the in-flight op is doing, for the status label.
    const [busyKind, setBusyKind,] = createSignal<'install' | 'disable' | 'remove'>('install',);

    const busyLabel = () => {
        switch (busyKind()) {
            case 'install': return 'Installing…';
            case 'remove': return 'Removing…';
            default: return 'Updating…';
        }
    };

    const run = async (kind: 'install' | 'disable' | 'remove', fn: () => void | Promise<void>,) => {
        setBusyKind(kind,);
        setBusy(true,);
        try {
            await fn();
        } finally {
            setBusy(false,);
        }
    };

    const onClick = () => {
        if (busy()) return;
        if (!enabled()) {
            if (missing().length > 0) { setModal('enable',); return; }
            void run('install', () => p.onChange(true,),);
        } else {
            if (dependents().length > 0) { setModal('disable',); return; }
            void run('disable', () => p.onChange(false,),);
        }
    };

    return (
        <div class="feature-toggle-row">
            <div class="feature-toggle-row__info">
                <div class="feature-toggle-row__label">
                    {cfg().label}
                    <Show when={(cfg().requires ?? []).length > 0}>
                        <span
                            class="feature-toggle-row__info-icon"
                            title={`Requires: ${(cfg().requires ?? []).map((k,) => getFeature(k,).label,).join(', ',)}`}
                        >ⓘ</span>
                    </Show>
                </div>
                <Show when={cfg().description}>
                    <small class="feature-toggle-row__desc">{cfg().description}</small>
                </Show>
                <Show when={!enabled() && !busy() && p.onRemove}>
                    <small class="feature-toggle-row__preserved">Disabled — data preserved</small>
                </Show>
            </div>

            <div class="feature-toggle-row__controls">
                <Show when={busy()}>
                    <span class="feature-toggle-row__busy">
                        <span class="feature-toggle-row__spinner" aria-hidden="true" />
                        {busyLabel()}
                    </span>
                </Show>
                <Show when={enabled() && p.onRemove && !busy()}>
                    <button
                        type="button"
                        class="feature-toggle-row__remove"
                        onClick={() => setModal('remove',)}
                    >
                        Remove…
                    </button>
                </Show>
                <button
                    type="button"
                    class={`feature-toggle-row__switch ${enabled() ? 'is-on' : ''} ${(!enabled() && missing().length > 0) ? 'is-blocked' : ''}`}
                    onClick={onClick}
                    disabled={busy()}
                    aria-pressed={enabled()}
                    aria-busy={busy()}
                    title={(!enabled() && missing().length > 0) ? 'Requires other features — click for details' : (enabled() ? 'Disable' : 'Enable')}
                >
                    <span class="feature-toggle-row__knob" />
                </button>
            </div>

            <Show when={modal() === 'enable'}>
                <FeatureDependencyModal
                    target={p.featureKey}
                    mode="enable"
                    chain={missing()}
                    onCancel={() => setModal(null,)}
                    onConfirm={async () => {
                        setModal(null,);
                        await run('install', () => p.onChange(true, { enableDependencies: true, },),);
                    }}
                />
            </Show>
            <Show when={modal() === 'disable'}>
                <FeatureDependencyModal
                    target={p.featureKey}
                    mode="disable"
                    chain={dependents()}
                    onCancel={() => setModal(null,)}
                    onConfirm={async () => {
                        setModal(null,);
                        await run('disable', () => p.onChange(false, { disableDependents: true, },),);
                    }}
                />
            </Show>
            <Show when={modal() === 'remove' && p.onRemove}>
                <FeatureRemoveModal
                    featureLabel={cfg().label}
                    onCancel={() => setModal(null,)}
                    onConfirm={async () => {
                        setModal(null,);
                        await run('remove', () => p.onRemove!(),);
                    }}
                />
            </Show>
        </div>
    );
};

export default FeatureToggleRow;
