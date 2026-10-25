/**
 * Preview a form as visitors get it — the SAME `FormRenderer` the Form block
 * and `{{ form() }}` render, inside the same `.block.block--form > .form-block`
 * wrappers, fed with the editor's CURRENT (unsaved) form. Submitting runs the
 * real validation, then shows the success message; nothing is sent or saved.
 */
import type { Form, } from '@sitesurge/types';
import { Component, createSignal, For, Show, } from 'solid-js';
import FormRenderer from '../../forms/FormRenderer';
import { useAppearance, } from '../../../hooks/useAppearance';
import { swatchCssVars, } from '../../../services/colorResolver';
import { swatches, } from '../../../services/siteColors';
import { appearanceCssVars, } from '../../../utils/appearanceStyle';
import ModalShell from '../common/ModalShell';
import './FormPreviewModal.scss';

export interface FormPreviewModalProps {
    open: boolean;
    onClose: () => void;
    /** The form as currently edited. */
    form: Form;
}

const FormPreviewModal: Component<FormPreviewModalProps> = (props,) => {
    const [sent, setSent,] = createSignal(false,);
    // A new FormRenderer per "Reset" / reopen, so answers start empty.
    const [run, setRun,] = createSignal(0,);
    const reset = () => { setSent(false,); setRun(run() + 1,); };
    const close = () => { reset(); props.onClose(); };
    // The modal renders in a portal OUTSIDE the admin root, so it does not
    // inherit the site tokens — set the public appearance (colours, fonts,
    // button colour, radius, swatches) on the stage, as the site's Layout does.
    const appearance = useAppearance();
    const stageStyle = () => ({ ...swatchCssVars(swatches(),), ...appearanceCssVars(appearance(), 'public',), });

    return (
        <ModalShell open={props.open} onClose={close} size="lg" showClose ariaLabel="Form preview" class="form-preview-modal">
            <div class="form-preview">
                <header class="form-preview__header">
                    <h2>Preview</h2>
                    <p class="form-help-muted">
                        As the form appears in a Form block or <code>{'{{ form() }}'}</code>, with your unsaved changes.
                        Submitting checks the answers but sends nothing.
                    </p>
                </header>
                <div class="form-preview__stage" style={stageStyle()}>
                    <Show
                        when={!sent()}
                        fallback={
                            <div class="form-preview__sent">
                                <p class="form-preview__sent-message">
                                    {props.form.successMessage || 'Thank you for your submission!'}
                                </p>
                                <p class="form-help-muted">Preview only — this submission was not sent.</p>
                                <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={reset}>Fill it in again</button>
                            </div>
                        }
                    >
                        {/* A new FormRenderer per run (keyed on the counter): answers start empty. */}
                        <For each={[run(),]}>
                            {() => (
                                <div class="block block--form">
                                    <div class="block__inner">
                                        <div class="form-block">
                                            <FormRenderer form={props.form} inline onCollect={() => { setSent(true,); }} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </div>
        </ModalShell>
    );
};

export default FormPreviewModal;
