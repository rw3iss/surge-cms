import { Title, } from '@solidjs/meta';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import type { ShopCollection, ShopCollectionCreateBody, ShopProduct, } from '@sitesurge/types';
import { FormCheck, FormField, } from '../../../components/admin/forms';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import ShopGuard from './ShopGuard';
import { slugify, } from './shopUtils';

interface Draft {
    id?: string;
    title: string;
    slug: string;
    description: string;
    isPublished: boolean;
    productIds: string[];
}

const emptyDraft = (): Draft => ({ title: '', slug: '', description: '', isPublished: false, productIds: [], });

const ShopCollectionsInner: Component = () => {
    const toast = useToast();
    const [collections, { refetch, },] = createResource(async () => {
        try { return await cms.shop.collections.list({ all: 'true', },) as ShopCollection[]; } catch { return [] as ShopCollection[]; }
    },);
    const [products,] = createResource(async () => {
        try { return (await cms.shop.products.list({ limit: 200, },)).data as ShopProduct[]; } catch { return [] as ShopProduct[]; }
    },);

    const [draft, setDraft,] = createSignal<Draft | null>(null,);
    const [saving, setSaving,] = createSignal(false,);
    const [productFilter, setProductFilter,] = createSignal('',);

    const openNew = () => { setProductFilter('',); setDraft(emptyDraft(),); };
    const openEdit = async (c: ShopCollection,) => {
        setProductFilter('',);
        // membership isn't on the list row; fetch by slug to get products
        let productIds: string[] = [];
        try {
            const detail = await cms.shop.collections.getBySlug(c.slug,);
            productIds = detail.products.map((p,) => p.id,);
        } catch {
            /* fall back to empty membership */
        }
        setDraft({
            id: c.id,
            title: c.title,
            slug: c.slug,
            description: c.description || '',
            isPublished: c.isPublished,
            productIds,
        },);
    };

    const setTitle = (v: string,) => {
        const d = draft();
        if (!d) return;
        setDraft({ ...d, title: v, slug: d.id ? d.slug : slugify(v,), },);
    };

    const toggleProduct = (id: string,) => {
        const d = draft();
        if (!d) return;
        setDraft({
            ...d,
            productIds: d.productIds.includes(id,) ? d.productIds.filter((x,) => x !== id,) : [...d.productIds, id,],
        },);
    };

    const save = async () => {
        const d = draft();
        if (!d || !d.title.trim() || !d.slug.trim()) { toast.error('Title and slug are required.',); return; }
        setSaving(true,);
        try {
            const body: ShopCollectionCreateBody = {
                title: d.title.trim(),
                slug: d.slug.trim(),
                description: d.description || null,
                isPublished: d.isPublished,
                productIds: d.productIds,
            };
            if (d.id) await cms.shop.collections.update(d.id, body,);
            else await cms.shop.collections.create(body,);
            toast.success('Collection saved.',);
            setDraft(null,);
            refetch();
        } catch {
            /* error bus */
        } finally {
            setSaving(false,);
        }
    };

    const remove = async (c: ShopCollection,) => {
        if (!confirm(`Delete collection "${c.title}"?`,)) return;
        try {
            await cms.shop.collections.remove(c.id,);
            toast.success('Collection deleted.',);
            refetch();
        } catch {
            /* error bus */
        }
    };

    const filteredProducts = () => {
        const q = productFilter().toLowerCase();
        const list = products() || [];
        return q ? list.filter((p,) => p.title.toLowerCase().includes(q,)) : list;
    };

    return (
        <div class="shop-admin">
            <Title>Shop Collections - Admin - RW</Title>
            <div class="admin-header">
                <h1>Collections</h1>
                <button class="btn btn--primary" onClick={openNew}>New Collection</button>
            </div>

            <Show
                when={(collections() || []).length}
                fallback={<div class="empty-state">No collections yet.</div>}
            >
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Title</th>
                                <th>Slug</th>
                                <th>Published</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={collections()}>
                                {(c,) => (
                                    <tr>
                                        <td>{c.title}</td>
                                        <td class="form-help-muted">{c.slug}</td>
                                        <td>
                                            <span class={`badge ${c.isPublished ? 'badge--success' : 'badge--muted'}`}>
                                                {c.isPublished ? 'Published' : 'Hidden'}
                                            </span>
                                        </td>
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
                        <h3 class="confirm-modal__title">{draft()!.id ? 'Edit' : 'New'} Collection</h3>
                        <FormField label="Title">
                            <input type="text" value={draft()!.title} onInput={(e,) => setTitle(e.currentTarget.value,)} />
                        </FormField>
                        <FormField label="Slug">
                            <input type="text" value={draft()!.slug} onInput={(e,) => setDraft({ ...draft()!, slug: e.currentTarget.value, },)} />
                        </FormField>
                        <FormField label="Description">
                            <textarea rows={2} value={draft()!.description} onInput={(e,) => setDraft({ ...draft()!, description: e.currentTarget.value, },)} />
                        </FormField>
                        <FormCheck
                            label="Published"
                            checked={draft()!.isPublished}
                            onChange={(v,) => setDraft({ ...draft()!, isPublished: v, },)}
                        />
                        <FormField label="Products">
                            <input
                                type="text"
                                placeholder="Filter products..."
                                value={productFilter()}
                                onInput={(e,) => setProductFilter(e.currentTarget.value,)}
                            />
                            <div class="shop-admin__product-picker">
                                <For each={filteredProducts()}>
                                    {(p,) => (
                                        <label class="shop-product-editor__check">
                                            <input
                                                type="checkbox"
                                                checked={draft()!.productIds.includes(p.id,)}
                                                onChange={() => toggleProduct(p.id,)}
                                            />
                                            {p.title}
                                        </label>
                                    )}
                                </For>
                                <Show when={!filteredProducts().length}>
                                    <span class="form-help-muted">No products.</span>
                                </Show>
                            </div>
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

const ShopCollections: Component = () => (
    <ShopGuard>
        <ShopCollectionsInner />
    </ShopGuard>
);

export default ShopCollections;
