/**
 * Cascade confirmation modal. Opened by `FeatureToggleRow` when the
 * operator clicks a toggle whose dependency state needs resolving:
 *
 *   - mode='enable':  target has unmet prerequisites — modal asks to
 *                     also enable them.
 *   - mode='disable': target has enabled dependents — modal asks to
 *                     also disable them.
 *
 * Confirm hits the same `PUT /settings` endpoint with the appropriate
 * `enableDependencies` / `disableDependents` flag set; the backend
 * runs the dependency planner + lazy-install migrations in the right
 * order.
 */
import { Component, For, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { FeatureKey, getFeature, } from '../../../config/features';

interface Props {
    target: FeatureKey;
    mode: 'enable' | 'disable';
    chain: FeatureKey[];
    onConfirm: () => void;
    onCancel: () => void;
}

const FeatureDependencyModal: Component<Props> = (p,) => {
    const verbCap = () => p.mode === 'enable' ? 'Enable' : 'Disable';
    const targetLabel = () => getFeature(p.target,).label;
    const chainLabels = () => p.chain.map((k,) => getFeature(k,).label,);
    const allLabels = () => [...chainLabels(), targetLabel(),];

    return (
        <Portal>
            <div class="confirm-modal-overlay" onClick={p.onCancel}>
                <div class="feature-dep-modal" onClick={(e,) => e.stopPropagation()}>
                    <h3>{verbCap()} {targetLabel()}?</h3>
                    <p>
                        {p.mode === 'enable'
                            ? `${targetLabel()} requires the following ${p.chain.length === 1 ? 'feature' : 'features'}. They will also be enabled:`
                            : `These ${p.chain.length === 1 ? 'feature depends' : 'features depend'} on ${targetLabel()} and will also be disabled:`}
                    </p>
                    <ul>
                        <For each={chainLabels()}>{(l,) => <li>{l}</li>}</For>
                    </ul>
                    <div class="modal-actions">
                        <button type="button" class="btn btn--secondary" onClick={p.onCancel}>Cancel</button>
                        <button
                            type="button"
                            class={`btn ${p.mode === 'enable' ? 'btn--primary' : 'btn--danger'}`}
                            onClick={p.onConfirm}
                        >
                            {verbCap()} {allLabels().join(' + ',)}
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default FeatureDependencyModal;
