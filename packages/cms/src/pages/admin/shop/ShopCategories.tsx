import { Title, } from '@solidjs/meta';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import { createSafeResource, } from '../../../hooks/createSafeResource';
import type { ShopCategory, ShopCategoryCreateBody, } from '@sitesurge/types';
import { FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import ShopifyManagedBanner from './ShopifyManagedBanner';
import { slugify, } from './shopUtils';

interface Draft {
    id?: string;
    name: string;
    slug: string;
    description: string;
    parentId: string;
    /** '' = keep current/auto; otherwise the 1-based display position. */
    position: string;
}

const emptyDraft = (): Draft => ({ name: '', slug: '', description: '', parentId: '', position: '', });

const ShopCategoriesInner: Component = () => {
    const toast = useToast();
    const [categories, { refetch, },] = createSafeResource(
        async () => await cms.shop.categories.list() as ShopCategory[],
        [] as ShopCategory[],
    );

    const [draft, setDraft,] = createSignal<Draft | null>(null,);
    const [saving, setSaving,] = createSignal(false,);

    // Local reorderable mirror of the fetched list.
    const [rows, setRows,] = createSignal<ShopCategory[]>([],);
    createEffect(() => { setRows(categories() || [],); },);

    const [dragIndex, setDragIndex,] = createSignal<number | null>(null,);
    const [overIndex, setOverIndex,] = createSignal<number | null>(null,);

    const onDrop = async (targetIndex: number,) => {
        const from = dragIndex();
        setDragIndex(null,);
        setOverIndex(null,);
        if (from === null || from === targetIndex) return;
        const arr = [...rows(),];
        const [moved,] = arr.splice(from, 1,);
        arr.splice(targetIndex, 0, moved,);
        setRows(arr,);
        try {
            await cms.shop.categories.reorder({ orderedIds: arr.map((c,) => c.id), },);
        } catch { /* error bus */ }
        refetch();
    };

    const openNew = () => setDraft(emptyDraft(),);
    const openEdit = (c: ShopCategory,) =>
        setDraft({
            id: c.id,
            name: c.name,
            slug: c.slug,
            description: c.description || '',
            parentId: c.parentId || '',
            position: c.position != null ? String(c.position + 1,) : '',
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
            let savedId = d.id;
            if (d.id) await cms.shop.categories.update(d.id, body,);
            else savedId = (await cms.shop.categories.create(body,)).id;

            // Apply the chosen Position (1-based) via a reorder: move this
            // category to that index in the flat list and renumber. '' = leave
            // where it is (a new category stays appended).
            if (d.position !== '' && savedId) {
                const fresh = await cms.shop.categories.list() as ShopCategory[];
                const ids = fresh.map((c,) => c.id).filter((id,) => id !== savedId);
                const target = Math.max(0, Math.min(Number(d.position,) - 1, ids.length,),);
                ids.splice(target, 0, savedId,);
                await cms.shop.categories.reorder({ orderedIds: ids, },);
            }
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
            <ShopifyManagedBanner note="Categories map to Shopify collections while Shopify is enabled; internal categories aren't used on the storefront." />

            <Show
                when={(categories() || []).length}
                fallback={<div class="empty-state">No categories yet.</div>}
            >
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th style={{ width: '32px', }} title="Drag to reorder" />
                                <th>Name</th>
                                <th>Slug</th>
                                <th>Parent</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={rows()}>
                                {(c, i) => (
                                    <tr
                                        classList={{ 'is-drop-target': overIndex() === i(), }}
                                        onDragOver={(e,) => { e.preventDefault(); setOverIndex(i(),); }}
                                        onDrop={() => onDrop(i(),)}
                                    >
                                        <td
                                            class="shop-products__drag"
                                            draggable={true}
                                            onDragStart={() => setDragIndex(i(),)}
                                            onDragEnd={() => { setDragIndex(null,); setOverIndex(null,); }}
                                            title="Drag to reorder"
                                        >
                                            ⠿
                                        </td>
                                        <td>{c.name}</td>
                                        <td class="form-help-muted">{c.slug}</td>
                                        <td>{(categories() || []).find((p,) => p.id === c.parentId,)?.name || '—'}</td>
                                        <td>
                                            <div class="table-actions">
                                                <button class="btn btn--small btn--secondary" onClick={() => openEdit(c,)}>Edit</button>
                                                <button class="btn btn--small btn--danger" onClick={() => remove(c,)}>Delete</button>
                                            </div>
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
                        {/* Row 1: Name + Slug (half each) */}
                        <div class="category-form-grid">
                            <FormField label="Name">
                                <input type="text" value={draft()!.name} onInput={(e,) => setName(e.currentTarget.value,)} />
                            </FormField>
                            <FormField label="Slug">
                                <input type="text" value={draft()!.slug} onInput={(e,) => setDraft({ ...draft()!, slug: e.currentTarget.value, },)} />
                            </FormField>
                            {/* Row 2: Parent + Position (half each) */}
                            <FormField label="Parent">
                                <select value={draft()!.parentId} onChange={(e,) => setDraft({ ...draft()!, parentId: e.currentTarget.value, },)}>
                                    <option value="">None</option>
                                    <For each={(categories() || []).filter((c,) => c.id !== draft()!.id,)}>
                                        {(c,) => <option value={c.id}>{c.name}</option>}
                                    </For>
                                </select>
                            </FormField>
                            <FormField label="Position">
                                <select value={draft()!.position} onChange={(e,) => setDraft({ ...draft()!, position: e.currentTarget.value, },)}>
                                    <option value="">—</option>
                                    <For each={Array.from({ length: (categories() || []).length || 1, }, (_, i) => i + 1,)}>
                                        {(n,) => <option value={String(n,)}>{n}</option>}
                                    </For>
                                </select>
                            </FormField>
                            {/* Row 3: Description (full width) */}
                            <FormField label="Description" class="category-form-grid__full">
                                <textarea rows={3} value={draft()!.description} onInput={(e,) => setDraft({ ...draft()!, description: e.currentTarget.value, },)} />
                            </FormField>
                        </div>
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
