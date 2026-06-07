/**
 * Single feature toggle row, dependency-aware. Used by Settings →
 * Features panel — one row per feature in `FEATURES`. Clicking the
 * switch either flips the feature immediately (no unresolved
 * dependencies) or opens the cascade-confirm modal.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { FeatureKey, getFeature, } from '../../../config/features';
import {
    isFeatureEnabled,
    getMissingPrerequisites,
    getEnabledDependents,
} from '../../../stores/siteSettings';
import FeatureDependencyModal from './FeatureDependencyModal';

interface ChangeOpts { enableDependencies?: boolean; disableDependents?: boolean; }

interface Props {
    featureKey: FeatureKey;
    onChange: (next: boolean, opts?: ChangeOpts,) => void | Promise<void>;
}

const FeatureToggleRow: Component<Props> = (p,) => {
    const cfg = () => getFeature(p.featureKey,);
    const enabled = () => isFeatureEnabled(p.featureKey,);
    const missing = () => getMissingPrerequisites(p.featureKey,);
    const dependents = () => getEnabledDependents(p.featureKey,);

    const [modal, setModal,] = createSignal<'enable' | 'disable' | null>(null,);

    const onClick = () => {
        if (!enabled()) {
            if (missing().length > 0) { setModal('enable',); return; }
            void p.onChange(true,);
        } else {
            if (dependents().length > 0) { setModal('disable',); return; }
            void p.onChange(false,);
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
            </div>
            <button
                type="button"
                class={`feature-toggle-row__switch ${enabled() ? 'is-on' : ''} ${(!enabled() && missing().length > 0) ? 'is-blocked' : ''}`}
                onClick={onClick}
                aria-pressed={enabled()}
                title={(!enabled() && missing().length > 0) ? 'Requires other features — click for details' : (enabled() ? 'Disable' : 'Enable')}
            >
                <span class="feature-toggle-row__knob" />
            </button>

            <Show when={modal() === 'enable'}>
                <FeatureDependencyModal
                    target={p.featureKey}
                    mode="enable"
                    chain={missing()}
                    onCancel={() => setModal(null,)}
                    onConfirm={async () => {
                        setModal(null,);
                        await p.onChange(true, { enableDependencies: true, },);
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
                        await p.onChange(false, { disableDependents: true, },);
                    }}
                />
            </Show>
        </div>
    );
};

export default FeatureToggleRow;
