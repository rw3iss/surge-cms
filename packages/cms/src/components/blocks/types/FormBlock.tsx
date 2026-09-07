/**
 * Embedded form.
 *
 * Split out of BlockRenderer.tsx, which held every block type in one
 * 1,332-line file. Behaviour is unchanged — this is a move, not a rewrite.
 */
import type { Block, Form, } from '@sitesurge/types';
import { Component, Show, createResource, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import FormRenderer from '../../forms/FormRenderer';

export const FormBlock: Component<{ block: Block; }> = (props,) => {
    const formId = () => props.block.settings.formId as string;
    const formSlug = () => props.block.settings.slug as string;

    const [form,] = createResource(
        () => formId() || formSlug(),
        async () => {
            const id = formId();
            const slug = formSlug();
            // Try slug first if available (public endpoint), then fall back to id
            if (slug) {
                try {
                    return await cms.forms.getBySlug(slug,) as Form;
                } catch { /* fall through to id */ }
            }
            if (id) {
                try {
                    return await cms.forms.getById(id,) as Form;
                } catch { /* fall through to null */ }
            }
            return null;
        },
    );

    return (
        <Show when={form()} fallback={
            <Show when={form.loading}>
                <p class="block-message">Loading form...</p>
            </Show>
        }>
            <div class="form-block">
                <FormRenderer form={form()!} inline={true} />
            </div>
        </Show>
    );
};
