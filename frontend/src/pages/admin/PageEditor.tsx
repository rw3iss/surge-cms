import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import BlockEditor, { BlockData, BlockType, BlockTypeOption, } from '../../components/admin/BlockEditor';
import ConfirmModal from '../../components/admin/ConfirmModal';
import PreviewOverlay from '../../components/admin/PreviewOverlay';
import { BlockRenderer, } from '../../components/BlockRenderer';
import { Header, } from '../../components/Layout/Header';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { api, } from '../../services/api';
import { BlockStyleService, } from '../../services/blockStyles';

const PAGE_BLOCK_TYPES: BlockTypeOption[] = [
    { type: 'rich_text' as BlockType, label: 'Rich Text', },
    { type: 'image' as BlockType, label: 'Image', },
    { type: 'video' as BlockType, label: 'Video', },
    { type: 'hero' as BlockType, label: 'Hero Banner', },
    { type: 'html' as BlockType, label: 'Custom HTML', },
    { type: 'social_feed' as BlockType, label: 'Social Feed', },
    { type: 'campaign' as BlockType, label: 'Campaign', },
    { type: 'form' as BlockType, label: 'Form', },
    { type: 'post' as BlockType, label: 'Post Embed', },
    { type: 'gallery' as BlockType, label: 'Gallery', },
];

let blockIdCounter = 0;
const generateBlockId = () => `block-${Date.now()}-${++blockIdCounter}`;

/** Convert backend page block to BlockData format used by BlockEditor */
function pageBlockToBlockData(block: any,): BlockData {
    // style comes as a resolved object from the backend
    // If it has an id, it's a template reference. Otherwise it's custom inline.
    const styleRef = block.style?.id ?
        { templateId: block.style.id, } :
        block.style ?
        { custom: block.style, } :
        undefined;

    return {
        id: block.id,
        type: block.type,
        sort_order: block.order ?? 0,
        data: {
            title: block.title || '',
            content: block.content || '',
            ...(block.settings || {}),
        },
        styleRef,
    };
}

/** Convert BlockData back to page block API format */
function blockDataToPageBlock(block: BlockData, order: number,) {
    const { title, content, __styleRef, ...settings } = block.data;
    // Build the style JSONB: { id: "uuid" } for template, or { backgroundColor: ... } for custom
    let style: any = undefined;
    const ref = (__styleRef as any) || block.styleRef;
    if (ref?.templateId) {
        style = { id: ref.templateId, };
    } else if (ref?.custom) {
        const { id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua, ...customProps } = ref.custom;
        style = Object.keys(customProps,).length > 0 ? customProps : undefined;
    }

    return {
        type: block.type,
        title: title || undefined,
        content: content || undefined,
        settings: Object.keys(settings,).length > 0 ? settings : {},
        order,
        isVisible: true,
        style: style || undefined,
    };
}

const AdminPageEditor: Component = () => {
    const params = useParams();
    const navigate = useNavigate();
    const isNew = () => !params.id || params.id === 'new';
    const { isDirty, markDirty, markClean, } = useUnsavedChanges();

    const [page,] = createResource(() => isNew() ? null : params.id, async (id,) => {
        if (!id) return null;
        const response = await api.get(`/pages/${id}`,);
        return response.success ? (response as any).data : null;
    },);

    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [originalBlockIds, setOriginalBlockIds,] = createSignal<Set<string>>(new Set(),);
    const [error, setError,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [showDeleteConfirm, setShowDeleteConfirm,] = createSignal(false,);
    const [showRestoreConfirm, setShowRestoreConfirm,] = createSignal(false,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [restoring, setRestoring,] = createSignal(false,);
    const isDeleted = () => status() === 'deleted';
    const [deleting, setDeleting,] = createSignal(false,);

    createEffect(() => {
        const p = page();
        if (p) {
            setTitle(p.title || '',);
            setSlug(p.slug || '',);
            setStatus(p.status || 'draft',);
            setAccessLevel(p.accessLevel || 'public',);
            if (p.blocks?.length) {
                const converted = p.blocks.map((b: any,) => pageBlockToBlockData(b,));
                setBlocks(converted,);
                setOriginalBlockIds(new Set<string>(p.blocks.map((b: any,) => String(b.id,)),),);
            }
        }
    },);

    const syncBlocks = async (pageId: string,) => {
        const currentBlocks = blocks();
        const origIds = originalBlockIds();

        // Determine which blocks are new, updated, or deleted
        const currentIds = new Set(currentBlocks.map(b => b.id),);
        const deletedIds = [...origIds,].filter(id => !currentIds.has(id,));
        const newBlocks = currentBlocks.filter(b => !origIds.has(b.id,));
        const existingBlocks = currentBlocks.filter(b => origIds.has(b.id,));

        // Delete removed blocks
        for (const id of deletedIds) {
            await api.delete(`/pages/${pageId}/blocks/${id}`,);
        }

        // Create new blocks
        for (let i = 0; i < newBlocks.length; i++) {
            const b = newBlocks[i];
            const order = currentBlocks.indexOf(b,);
            await api.post(`/pages/${pageId}/blocks`, blockDataToPageBlock(b, order,),);
        }

        // Update existing blocks
        for (const b of existingBlocks) {
            const order = currentBlocks.indexOf(b,);
            await api.put(`/pages/${pageId}/blocks/${b.id}`, blockDataToPageBlock(b, order,),);
        }

        // Reorder all blocks
        const blockIds = currentBlocks
            .filter(b => origIds.has(b.id,))
            .map(b => b.id);
        if (blockIds.length > 1) {
            await api.put(`/pages/${pageId}/blocks/reorder`, { blockIds, },);
        }
    };

    const handleSave = async () => {
        setError('',);
        if (!title()) {
            setError('Title is required',);
            return;
        }
        if (!slug()) {
            setError('Slug is required',);
            return;
        }

        setSaving(true,);

        try {
            const data = {
                title: title(),
                slug: slug(),
                status: status(),
                accessLevel: accessLevel(),
            };

            let pageId = params.id;

            if (isNew()) {
                const response = await api.post('/pages', data,);
                if (!response.success) {
                    setError((response as any).error?.message || 'Failed to create page',);
                    setSaving(false,);
                    return;
                }
                pageId = (response as any).data.id;
            } else {
                const response = await api.put(`/pages/${params.id}`, data,);
                if (!response.success) {
                    setError((response as any).error?.message || 'Failed to save page',);
                    setSaving(false,);
                    return;
                }
            }

            // Sync blocks to backend
            if (pageId) {
                await syncBlocks(pageId,);
            }

            markClean();
            navigate('/admin/pages',);
        } catch (err: any) {
            setError(err.message || 'Failed to save page',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <div>
            <Title>{isNew() ? 'New Page' : 'Edit Page'} - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>{isNew() ? 'New Page' : 'Edit Page'}</h1>
                <div class="admin-header__actions">
                    <Show when={!isNew() && page()}>
                        <Show when={isDeleted()}>
                            <button
                                class="btn btn--secondary"
                                onClick={() => setShowRestoreConfirm(true,)}
                                disabled={restoring()}
                            >
                                {restoring() ? 'Restoring...' : 'Un-delete Page'}
                            </button>
                        </Show>
                        <Show when={!isDeleted() && (isDirty() || status() === 'draft')}>
                            <button class="btn btn--ghost" onClick={() => setShowPreview(true,)}>
                                Preview Changes
                            </button>
                        </Show>
                        <Show when={status() === 'published'}>
                            <a href={`/${page()?.slug}`} target="_blank" class="btn btn--secondary">
                                View Page &nearr;
                            </a>
                        </Show>
                    </Show>
                    <button class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving...' : 'Save Page'}
                    </button>
                </div>
            </div>
            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>
            <div class="admin-form">
                <div class="form-section">
                    <h2>Page Details</h2>
                    <div class="form-group">
                        <label>Title</label>
                        <input
                            type="text"
                            value={title()}
                            onInput={(e,) => {
                                setTitle(e.currentTarget.value,);
                                markDirty();
                            }}
                            placeholder="Page title"
                        />
                    </div>
                    <div class="form-row">
                        <div class="form-group form-group--grow">
                            <label>Slug</label>
                            <input
                                type="text"
                                value={slug()}
                                onInput={(e,) => {
                                    setSlug(e.currentTarget.value,);
                                    markDirty();
                                }}
                                placeholder="page-slug"
                            />
                            <span class="form-help">URL path for this page (e.g. "about" → /about)</span>
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select
                                value={status()}
                                onChange={(e,) => {
                                    setStatus(e.currentTarget.value,);
                                    markDirty();
                                }}
                            >
                                <option value="draft">Draft</option>
                                <option value="published">Published</option>
                                <option value="archived">Archived</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Access Level</label>
                            <select
                                value={accessLevel()}
                                onChange={(e,) => {
                                    setAccessLevel(e.currentTarget.value,);
                                    markDirty();
                                }}
                            >
                                <option value="public">Public</option>
                                <option value="member">Members Only</option>
                                <option value="patron">Patrons Only</option>
                            </select>
                            <span class="form-help">Who can view this page</span>
                        </div>
                    </div>
                </div>

                <div class="form-section">
                    <BlockEditor
                        title="Page Content"
                        blocks={blocks()}
                        onBlocksChange={(newBlocks,) => {
                            setBlocks(newBlocks,);
                            markDirty();
                        }}
                        blockTypes={PAGE_BLOCK_TYPES}
                    />
                </div>

                <div class="form-actions" style={{ 'justify-content': 'space-between', }}>
                    <div style={{ display: 'flex', gap: '12px', }}>
                        <button class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                            {saving() ? 'Saving...' : 'Save Page'}
                        </button>
                        <button class="btn btn--secondary" onClick={() => navigate('/admin/pages',)}>Cancel</button>
                    </div>
                    <Show when={!isNew() && !isDeleted()}>
                        <button
                            class="btn btn--danger"
                            onClick={() => setShowDeleteConfirm(true,)}
                            disabled={deleting()}
                        >
                            {deleting() ? 'Deleting...' : 'Delete Page'}
                        </button>
                    </Show>
                </div>
            </div>
            <ConfirmModal
                open={showDeleteConfirm()}
                title="Delete Page"
                message="Are you sure you want to delete this page? It will be moved to the trash and can be restored later."
                confirmLabel="Delete"
                onConfirm={async () => {
                    setShowDeleteConfirm(false,);
                    setDeleting(true,);
                    try {
                        const response = await api.put(`/pages/${params.id}`, { status: 'deleted', },);
                        if (response.success) {
                            markClean();
                            navigate('/admin/pages',);
                        } else {
                            setError((response as any).error?.message || 'Failed to delete page',);
                        }
                    } catch (err: any) {
                        setError(err.message || 'Failed to delete page',);
                    } finally {
                        setDeleting(false,);
                    }
                }}
                onCancel={() => setShowDeleteConfirm(false,)}
                danger={true}
            />
            <ConfirmModal
                open={showRestoreConfirm()}
                title="Restore Page"
                message="Are you sure you want to restore this page? It will be changed back to draft status."
                confirmLabel="Restore"
                onConfirm={async () => {
                    setShowRestoreConfirm(false,);
                    setRestoring(true,);
                    try {
                        const response = await api.put(`/pages/${params.id}`, { status: 'draft', },);
                        if (response.success) {
                            setStatus('draft',);
                            markClean();
                        } else {
                            setError((response as any).error?.message || 'Failed to restore page',);
                        }
                    } catch (err: any) {
                        setError(err.message || 'Failed to restore page',);
                    } finally {
                        setRestoring(false,);
                    }
                }}
                onCancel={() => setShowRestoreConfirm(false,)}
            />

            {/* Inline preview overlay — no navigation, preserves editor state */}
            <Show when={showPreview()}>
                <PreviewOverlay backUrl="" onClose={() => setShowPreview(false,)}>
                    <Header navigation={[]} siteName="Surge Media" />
                    <main style={{ 'min-height': '70vh', }}>
                        <For each={blocks()}>
                            {(block,) => {
                                const { title: t, content: c, __styleRef, ...rest } = block.data || {};
                                // Resolve style: use styleRef or __styleRef, resolve template IDs from cache
                                // Prefer __styleRef (latest edits) over styleRef (initial load)
                                const ref = (__styleRef as any) || block.styleRef;
                                let resolvedStyle: any = undefined;
                                if (ref?.custom) {
                                    resolvedStyle = ref.custom;
                                } else if (ref?.templateId) {
                                    // Look up full style from the client-side cache
                                    const allStyles = BlockStyleService.getCached();
                                    const tmpl = allStyles.find((s: any,) => s.id === ref.templateId);
                                    resolvedStyle = tmpl || { id: ref.templateId, };
                                }
                                const renderBlock = {
                                    id: block.id,
                                    pageId: params.id,
                                    type: block.type,
                                    title: t || null,
                                    content: c || null,
                                    settings: rest,
                                    order: block.sort_order || 0,
                                    isVisible: true,
                                    style: resolvedStyle,
                                    createdAt: new Date(),
                                    updatedAt: new Date(),
                                };
                                return <BlockRenderer block={renderBlock as any} />;
                            }}
                        </For>
                        <Show when={!blocks().length}>
                            <div style={{ padding: '4rem 2rem', 'text-align': 'center', color: '#999', }}>
                                No content blocks to preview
                            </div>
                        </Show>
                    </main>
                </PreviewOverlay>
            </Show>
        </div>
    );
};

export default AdminPageEditor;
