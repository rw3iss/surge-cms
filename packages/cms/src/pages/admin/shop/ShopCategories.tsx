import { Title, } from '@solidjs/meta';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { ShopCategory, ShopCategoryCreateBody, } from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import { slugify, } from './shopUtils';

interface Draft {
    id?: string;
    name: string;
    slug: string;
    description: string;
    parentId: string;
}

const emptyDraft = (): Draft => ({ name: '', slug: '', description: '', parentId: '', });

const ShopCategoriesInner: Component = () => {
    const toast = useToast();
    const [categories, { refetch, },] = createResource(async () => {
        try { return await cms.shop.categories.list() as ShopCategory[]; } catch { return [] as ShopCategory[]; }
    },);

    const [draft, setDraft,] = createSignal<Draft | null>(null,);
    const [saving, setSaving,] = createSignal(false,);

    const openNew = () => setDraft(emptyDraft(),);
    const openEdit = (c: ShopCategory,) =>
        setDraft({
            id: c.id,
            name: c.name,
            slug: c.slug,
            description: c.description || '',
            parentId: c.parentId || '',
        },);

    const setName = (v: string,) => {
        const d = draft();
        if (!d) return;
        setDraft({ ...d, name: v, slug: d.id ? d.slug : slugify(v,), },);
    };

    const save = async () => {
        const d = draft();
        if (!d || !d.name.trim() || !d.slug.trim()) { toast.error('Name and slug are required.',); return; }
        setSaving(true,);
        try {
            const body: ShopCategoryCreateBody = {
                name: d.name.trim(),
                slug: d.slug.trim(),
                description: d.description || null,
                parentId: d.parentId || null,
            };
            if (d.id) await cms.shop.categories.update(d.id, body,);
            else await cms.shop.categories.create(body,);
            toast.success('Category saved.',);
            setDraft(null,);
            refetch();
        } catch {
            /* error bus */
        } finally {
            setSaving(false,);
        }
    };

    const remove = async (c: ShopCategory,) => {
        if (!confirm(`Delete category "${c.name}"?`,)) return;
        try {
            await cms.shop.categories.remove(c.id,);
            toast.success('Category deleted.',);
            refetch();
        } catch {
            /* error bus */
        }
    };

    return (
        <div class="shop-admin">
            <Title>Shop Categories - Admin - RW</Title>
            <div class="admin-header">
                <h1>Categories</h1>
                <button class="btn btn--primary" onClick={openNew}>New Category</button>
            </div>

            <Show
                when={(categories() || []).length}
                fallback={<div class="empty-state">No categories yet.</div>}
            >
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Slug</th>
                                <th>Parent</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={categories()}>
                                {(c,) => (
                                    <tr>
                                        <td>{c.name}</td>
                                        <td class="form-help-muted">{c.slug}</td>
                                        <td>{(categories() || []).find((p,) => p.id === c.parentId,)?.name || '—'}</td>
                                        <td>
                                            <button class="btn btn--small btn--secondary" onClick={() => openEdit(c,)}>Edit</button>
                                            <button class="btn btn--small btn--danger" onClick={() => remove(c,)}>Delete</button>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>

            <Show when={draft()}>
                <div class="confirm-modal-overlay" onClick={(e,) => { if (e.target === e.currentTarget) setDraft(null,); }}>
                    <div class="confirm-modal shop-admin__edit-modal">
                        <h3 class="confirm-modal__title">{draft()!.id ? 'Edit' : 'New'} Category</h3>
                        <FormField label="Name">
                            <input type="text" value={draft()!.name} onInput={(e,) => setName(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Slug">
                            <input type="text" value={draft()!.slug} onInput={(e,) => setDraft({ ...draft()!, slug: e.currentTarget.value, },)} />
                        </FormField>
                        <FormField label="Parent" inline>
                            <select value={draft()!.parentId} onChange={(e,) => setDraft({ ...draft()!, parentId: e.currentTarget.value, },)}>
                                <option value="">None</option>
                                <For each={(categories() || []).filter((c,) => c.id !== draft()!.id,)}>
                                    {(c,) => <option value={c.id}>{c.name}</option>}
                                </For>
                            </select>
                        </FormField>
                        <FormField label="Description">
                            <textarea rows={3} value={draft()!.description} onInput={(e,) => setDraft({ ...draft()!, description: e.currentTarget.value, },)} />
                        </FormField>
                        <div class="confirm-modal__actions">
                            <button class="btn btn--secondary" onClick={() => setDraft(null,)}>Cancel</button>
                            <button class="btn btn--primary" onClick={save} disabled={saving()}>
                                {saving() ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

const ShopCategories: Component = () => (
    <ShopGuard>
        <ShopCategoriesInner />
    </ShopGuard>
);

export default ShopCategories;
