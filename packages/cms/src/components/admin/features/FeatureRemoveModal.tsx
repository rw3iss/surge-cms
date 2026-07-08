/**
 * Destructive uninstall confirmation modal. Opened by `FeatureToggleRow`
 * when the operator clicks the "Remove…" button on an enabled feature.
 *
 * Uninstalling a feature drops its tables + all associated data — this is
 * irreversible, so the confirm button stays disabled until the operator
 * types the feature label (or the word "REMOVE") to prove intent.
 * `onConfirm` fires the passed handler (which calls
 * `cms.settings.uninstallFeature`).
 */
import { Component, createSignal, } from 'solid-js';
import { Portal, } from 'solid-js/web';

interface Props {
    featureLabel: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

const FeatureRemoveModal: Component<Props> = (p,) => {
    const [typed, setTyped,] = createSignal('',);

    const matches = () => {
        const v = typed().trim();
        return v === p.featureLabel || v.toUpperCase() === 'REMOVE';
    };

    return (
        <Portal>
            <div class="confirm-modal-overlay" onClick={p.onCancel}>
                <div class="feature-dep-modal feature-remove-modal" onClick={(e,) => e.stopPropagation()}>
                    <h3>Remove {p.featureLabel}?</h3>
                    <p class="feature-remove-modal__warning">
                        This permanently deletes all {p.featureLabel} data and tables. This cannot be undone.
                    </p>
                    <label class="feature-remove-modal__confirm">
                        <span>
                            Type <strong>{p.featureLabel}</strong> (or <strong>REMOVE</strong>) to confirm:
                        </span>
                        <input
                            type="text"
                            value={typed()}
                            onInput={(e,) => setTyped(e.currentTarget.value,)}
                            placeholder={p.featureLabel}
                            autofocus
                        />
                    </label>
                    <div class="modal-actions">
                        <button type="button" class="btn btn--secondary" onClick={p.onCancel}>Cancel</button>
                        <button
                            type="button"
                            class="btn btn--danger"
                            disabled={!matches()}
                            onClick={() => { void p.onConfirm(); }}
                        >
                            Remove permanently
                        </button>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default FeatureRemoveModal;
