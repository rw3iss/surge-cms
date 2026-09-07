/**
 * Components — reusable block templates bound to no entity type.
 *
 * A component is one or more blocks (nested, styled, breakpoint-aware) authored
 * once and referenced from anywhere by a `template` block. Referenced, not
 * copied: editing here changes every place it is used.
 *
 * Storage is the SAME `content_block_templates` table the entity system uses;
 * these rows simply have no `entity_type_key`. The editor is literally the same
 * component (`TemplateEditor`), which is why there is nothing here but a list.
 */
import { Component, createResource, For, Show, } from 'solid-js';
import { A, useNavigate, } from '@solidjs/router';
import { Title, } from '@solidjs/meta';
import type { ContentBlockTemplate, } from '@sitesurge/types';
import { cms, } from '../../../services/cmsClient';
import { formatDate, } from '@sitesurge/types';

const ComponentsList: Component = () => {
    const navigate = useNavigate();
    const [templates, { refetch, },] = createResource(async () => {
        try {
            return await cms.components.list();
        } catch {
            return [] as ContentBlockTemplate[];
        }
    },);

    const handleDelete = async (t: ContentBlockTemplate,) => {
        if (!confirm(`Delete "${t.name}"? Any block referencing it will stop rendering.`,)) return;
        try {
            await cms.components.remove(t.id,);
            void refetch();
        } catch { /* error bus surfaces the toast */ }
    };

    const handleCopy = async (t: ContentBlockTemplate,) => {
        try {
            const created = await cms.components.create({
                name: `${t.name} copy`,
                description: t.description ?? undefined,
                mode: t.mode,
                maxRecords: t.maxRecords ?? null,
            } as never,);
            const blocks = await cms.components.getBlocks(t.id,);
            if (blocks.length > 0) await cms.components.saveBlocks(created.id, blocks,);
            navigate(`/admin/components/${created.id}`,);
        } catch { /* error bus surfaces the toast */ }
    };

    return (
        <div class="admin-page">
            <Title>Components - Admin</Title>
            <div class="admin-header">
                <h1>Components</h1>
                <div class="admin-header__actions">
                    <A href="/admin/components/new" class="ui-button ui-button--primary">+ New component</A>
                </div>
            </div>

            <Show
                when={(templates() ?? []).length > 0}
                fallback={
                    <div class="empty-state">
                        No components yet. A component is a reusable set of blocks you can drop
                        onto any page with a <strong>Template</strong> block — edit it here and
                        every use updates.
                    </div>
                }
            >
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Description</th>
                                <th>Mode</th>
                                <th>Updated</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            <For each={templates()}>
                                {(t,) => (
                                    <tr>
                                        <td>
                                            <A href={`/admin/components/${t.id}`} class="table-link">{t.name}</A>
                                        </td>
                                        <td>{t.description || '—'}</td>
                                        <td>{t.mode}</td>
                                        <td>{t.updatedAt ? formatDate(t.updatedAt,) : '—'}</td>
                                        <td class="admin-table__actions">
                                            <A href={`/admin/components/${t.id}`} class="ui-button ui-button--sm ui-button--ghost">
                                                Edit
                                            </A>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--sm ui-button--ghost"
                                                onClick={() => void handleCopy(t,)}
                                            >
                                                Copy
                                            </button>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--sm ui-button--danger"
                                                onClick={() => void handleDelete(t,)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </div>
    );
};

export default ComponentsList;
