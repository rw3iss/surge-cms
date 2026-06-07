/**
 * Near-fullscreen email preview modal. Renders the email HTML inside
 * an iframe (isolates email CSS from admin CSS) and exposes the
 * detected `{{...}}` tokens as form inputs so the operator can poke at
 * sample values.
 *
 * Re-renders on a 250ms debounce whenever variables change.
 */
import { Component, createEffect, createSignal, on, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import { mailTemplatesApi, } from '../../../services/api';
import VariableForm from './VariableForm';

interface Props {
    blocks: unknown[];
    subject: string;
    preheader?: string;
    onClose: () => void;
}

const DEBOUNCE_MS = 250;

const MailPreviewModal: Component<Props> = (p,) => {
    const [vars, setVars,] = createSignal<Record<string, string>>({},);
    const [html, setHtml,] = createSignal('',);
    const [renderedSubject, setRenderedSubject,] = createSignal(p.subject,);
    const [detected, setDetected,] = createSignal<string[]>([],);
    const [varsOpen, setVarsOpen,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(true,);
    const [error, setError,] = createSignal<string | null>(null,);

    const fetchPreview = async (): Promise<void> => {
        setLoading(true,);
        setError(null,);
        try {
            const res = await mailTemplatesApi.preview({
                blocks: p.blocks,
                subject: p.subject,
                preheader: p.preheader,
                variables: vars(),
            },);
            if (res.success && res.data) {
                const d = res.data as { html: string; subject: string; preheader?: string; detectedVariables: string[]; };
                setHtml(d.html,);
                setRenderedSubject(d.subject,);
                setDetected(d.detectedVariables,);
            } else {
                setError(typeof res.error === 'string' ? res.error : 'Preview failed.',);
            }
        } catch (e) {
            setError(String(e,),);
        } finally {
            setLoading(false,);
        }
    };

    // Debounced re-fetch whenever vars (or blocks via Solid's reactivity) change.
    let debounceHandle: ReturnType<typeof setTimeout> | null = null;
    createEffect(on(
        () => [vars(), p.blocks, p.subject, p.preheader,],
        () => {
            if (debounceHandle) clearTimeout(debounceHandle,);
            debounceHandle = setTimeout(() => { void fetchPreview(); }, DEBOUNCE_MS,);
        },
    ),);

    return (
        <Portal>
            <div class="confirm-modal-overlay" onClick={p.onClose}>
                <div class="mail-preview-modal" onClick={(e,) => e.stopPropagation()}>
                    <header class="mail-preview-modal__header">
                        <div class="mail-preview-modal__subject">
                            <span class="mail-preview-modal__label">Subject:</span>
                            <strong>{renderedSubject() || '(no subject)'}</strong>
                        </div>
                        <button type="button" class="modal-close" onClick={p.onClose} aria-label="Close">×</button>
                    </header>

                    <div class="mail-preview-modal__vars">
                        <button
                            type="button"
                            class="mail-preview-modal__vars-toggle"
                            onClick={() => setVarsOpen(!varsOpen(),)}
                        >
                            {varsOpen() ? '▼' : '▶'} Variables ({detected().length})
                        </button>
                        <Show when={varsOpen()}>
                            <Show
                                when={detected().length > 0}
                                fallback={<p class="form-help-muted">No variables detected in this template yet.</p>}
                            >
                                <VariableForm paths={detected()} values={vars()} onChange={setVars} />
                            </Show>
                        </Show>
                    </div>

                    <Show when={error()}>
                        <div class="alert alert--error">{error()}</div>
                    </Show>

                    <iframe
                        class="mail-preview-modal__frame"
                        srcdoc={html()}
                        title="Email preview"
                    />

                    <footer class="mail-preview-modal__footer">
                        <Show when={loading()}>
                            <span class="mail-preview-modal__loading">Rendering…</span>
                        </Show>
                        <button type="button" class="btn btn--secondary" onClick={p.onClose}>Close</button>
                    </footer>
                </div>
            </div>
        </Portal>
    );
};

export default MailPreviewModal;
