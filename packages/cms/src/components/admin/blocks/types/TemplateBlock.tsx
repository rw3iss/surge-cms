/**
 * Edit panel for a `template` block: pick which Component to render.
 *
 * The block stores only `settings.templateId` — a REFERENCE. Nothing about the
 * component is copied here, so editing it under Components updates every block
 * using it. That is the whole point of the type; a copy would be a group block.
 */
import { Component, createResource, Show, } from 'solid-js';
import { A, } from '@solidjs/router';
import type { ContentBlockTemplate, } from '@sitesurge/types';
import { cms, } from '../../../../services/cmsClient';
import FormField from '../../forms/FormField';

export interface TemplateBlockEditProps {
    settings: Record<string, unknown>;
    onChange: (patch: Record<string, unknown>,) => void;
}

const TemplateBlockEdit: Component<TemplateBlockEditProps> = (props,) => {
    const [templates] = createResource(async () => {
        try {
            return await cms.components.list();
        } catch {
            return [] as ContentBlockTemplate[];
        }
    },);

    const selectedId = () => (props.settings.templateId as string | undefined) ?? '';
    const selected = () => (templates() ?? []).find((t,) => t.id === selectedId());

    return (
        <div class="block-edit-form__field template-block-edit">
            <FormField
                label="Component"
                hint="Rendered live from the component — editing it there updates every block using it."
            >
                <Show
                    when={(templates() ?? []).length > 0}
                    fallback={
                        <p class="form-help-muted">
                            No components yet. Create one under <A href="/admin/components">Components</A>.
                        </p>
                    }
                >
                    {/* Select + action on one row. The row wraps on a narrow
                        panel rather than shrinking the select to nothing —
                        the block edit panel is itself narrow on mobile. */}
                    <div class="template-block-edit__row">
                        <select
                            class="template-block-edit__select"
                            value={selectedId()}
                            onChange={(e,) => props.onChange({ templateId: e.currentTarget.value, },)}
                        >
                            <option value="">Select a component…</option>
                            {(templates() ?? []).map((t,) => <option value={t.id}>{t.name}</option>)}
                        </select>
                        <Show when={selected()}>
                            <A
                                href={`/admin/components/${selected()!.id}`}
                                class="ui-button ui-button--sm ui-button--secondary template-block-edit__edit"
                                target="_blank"
                            >
                                Edit Component
                            </A>
                        </Show>
                    </div>
                </Show>
            </FormField>

            <Show when={selected()?.description}>
                <p class="form-help-muted">{selected()!.description}</p>
            </Show>
        </div>
    );
};

export default TemplateBlockEdit;
