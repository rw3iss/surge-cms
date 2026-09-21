/**
 * Near-fullscreen email preview modal. Renders the email HTML inside
 * an iframe (isolates email CSS from admin CSS) and exposes the
 * detected `{{...}}` tokens as form inputs so the operator can poke at
 * sample values.
 *
 * Re-renders on a 250ms debounce whenever variables change.
 */
import { Component, createEffect, createSignal, For, on, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import type { MailCssWarning, MailTemplatePreviewResponse, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
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
    const [cssWarnings, setCssWarnings,] = createSignal<MailCssWarning[]>([],);
    const [warnOpen, setWarnOpen,] = createSignal(false,);

    const fetchPreview = async (): Promise<void> => {
        setLoading(true,);
        setError(null,);
        try {
            const d = await cms.mailTemplates.preview({
                blocks: p.blocks,
                subject: p.subject,
                preheader: p.preheader,
                variables: vars(),
            } as any,) as MailTemplatePreviewResponse;
            setHtml(d.html,);
            setRenderedSubject(d.subject,);
            setDetected(d.detectedVariables,);
            setCssWarnings(d.cssWarnings ?? [],);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Preview failed.',);
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


                    {/* What the preview CANNOT show you. This modal renders in a
                        browser with a full CSS engine; an inbox has far less of
                        one, so a Custom HTML block can look right here and arrive
                        wrong. Placed ABOVE the frame because the whole point is
                        that the frame below is the flattering version. */}
                    <Show when={cssWarnings().length > 0}>
                        <div class="alert alert--warning mail-preview-modal__warnings">
                            <button
                                type="button"
                                class="mail-preview-modal__vars-toggle"
                                onClick={() => setWarnOpen(!warnOpen(),)}
                            >
                                {warnOpen() ? '▼' : '▶'} {cssWarnings().length} style
                                {cssWarnings().length === 1 ? '' : 's'} may not survive in email
                            </button>
                            <Show when={warnOpen()}>
                                <ul class="mail-preview-modal__warning-list">
                                    <For each={cssWarnings()}>{(w,) => (
                                        <li>
                                            <strong>{w.message}</strong>
                                            <div class="form-help-muted">{w.fix}</div>
                                        </li>
                                    )}</For>
                                </ul>
                            </Show>
                        </div>
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
                        <button type="button" class="ui-button ui-button--secondary" onClick={p.onClose}>Close</button>
                    </footer>
                </div>
            </div>
        </Portal>
    );
};

export default MailPreviewModal;
