import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/AutoSaveIndicator';
import BlockEditor from '../../components/admin/BlockEditor';
import CollapsiblePanel from '../../components/admin/CollapsiblePanel';
import ConfirmModal from '../../components/admin/ConfirmModal';
import { BlockData, } from '../../components/admin/ContentBlock';
import EditorSaveBar from '../../components/admin/EditorSaveBar';
import PreviewOverlay from '../../components/admin/PreviewOverlay';
import RevisionsPanel from '../../components/admin/RevisionsPanel';
import { Header, } from '../../components/Layout/Header';
import PostContentBlock from '../../components/PostContentBlock';
import { useToast, } from '../../components/Toast';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import type { AppearanceSettings, } from '@rw/shared';
import { api, fetchAppearance, } from '../../services/api';
import { BlockStyleService, } from '../../services/blockStyles';
import { appearanceCssVars, } from '../../utils/appearanceStyle';

let blockIdCounter = 0;
const generateBlockId = () => `block-${Date.now()}-${++blockIdCounter}`;

const AdminPostEditor: Component = () => {
    const params = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => !params.id || params.id === 'new';
    const { isDirty, markDirty, markClean, } = useUnsavedChanges();

    const [post,] = createResource(() => isNew() ? null : params.id, async (id,) => {
        if (!id) return null;
        const response = await api.get(`/posts/${id}`,);
        return response.success ? (response as any).data : null;
    },);

    // Load site appearance for the preview container
    const [appearance,] = createResource(async () => {
        const response = await fetchAppearance();
        return response.success ? response.data as AppearanceSettings : null;
    },);

    /**
     * Inline styles applied to the block-preview container so the
     * WYSIWYG matches the live site. The mapping itself lives in
     * utils/appearanceStyle.ts and is shared with the public Layout
     * and AdminLayout.
     */
    const siteContainerStyle = () => appearanceCssVars(appearance(), 'public',);

    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [excerpt, setExcerpt,] = createSignal('',);
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
    const [tags, setTags,] = createSignal('',);
    const [publishAt, setPublishAt,] = createSignal('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    const { error, saving, beginSave, endSave, showError, setError, } = useEditorState();
    const [showDeleteConfirm, setShowDeleteConfirm,] = createSignal(false,);
    const [showRestoreConfirm, setShowRestoreConfirm,] = createSignal(false,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [restoring, setRestoring,] = createSignal(false,);
    const isDeleted = () => status() === 'deleted';

    useKeyboardShortcuts([
        { key: 's', ctrl: true, handler: () => handleSave(), },
    ],);

    // Auto-save draft to localStorage
    const autoSave = useAutoSave({
        key: `post-draft-${params.id || 'new'}`,
        state: () => ({
            title: title(),
            slug: slug(),
            excerpt: excerpt(),
            status: status(),
            accessLevel: accessLevel(),
            tags: tags(),
            publishAt: publishAt(),
            blocks: blocks(),
        }),
    },);

    // Offer to restore on load for new posts (only if draft exists and state is empty)
    createEffect(() => {
        if (!isNew()) return;
        if (title() || blocks().length) return;
        const draft = autoSave.getDraft();
        if (draft && confirm('A draft was found from a previous session. Restore it?',)) {
            const d = draft.data as any;
            setTitle(d.title || '',);
            setSlug(d.slug || '',);
            setExcerpt(d.excerpt || '',);
            setStatus(d.status || 'draft',);
            setAccessLevel(d.accessLevel || 'public',);
            setTags(d.tags || '',);
            setPublishAt(d.publishAt || '',);
            setBlocks(d.blocks || [],);
        }
    },);

    createEffect(() => {
        const p = post();
        if (p) {
            setTitle(p.title || '',);
            setSlug(p.slug || '',);
            setExcerpt(p.excerpt || '',);
            setStatus(p.status || 'draft',);
            setAccessLevel(p.accessLevel || 'public',);
            setTags((p.tags || []).join(', ',),);
            if (p.publishAt) {
                setPublishAt(new Date(p.publishAt,).toISOString().slice(0, 16,),);
            } else {
                setPublishAt('',);
            }
            if (p.contentBlocks?.length) {
                const converted = p.contentBlocks.map((b: any,) => {
                    // b.style comes from backend: { id: "uuid", ...props } for template, or { backgroundColor: ... } for custom
                    const styleRef = b.style?.id ?
                        { templateId: b.style.id, } :
                        b.style ?
                        { custom: b.style, } :
                        undefined;
                    return {
                        id: b.id || generateBlockId(),
                        type: b.type,
                        sort_order: b.sortOrder ?? b.sort_order,
                        data: b.data || {},
                        styleRef,
                    };
                },);
                setBlocks(converted,);
                setSavedBlocks(structuredClone(converted,),);
            }
        }
    },);

    const handleSave = async () => {
        if (!title()) {
            setError('Title is required',);
            return;
        }
        if (!slug()) {
            setError('Slug is required',);
            return;
        }

        beginSave();

        const tagList = tags().split(',',).map(t => t.trim()).filter(Boolean,);
        const data: any = {
            title: title(),
            slug: slug(),
            excerpt: excerpt(),
            status: status(),
            accessLevel: accessLevel(),
            tags: tagList,
            publishAt: publishAt() ? new Date(publishAt(),).toISOString() : null,
            contentBlocks: blocks().map((b, i,) => ({
                id: b.id.startsWith('block-',) ? undefined : b.id,
                type: b.type,
                sort_order: i,
                data: b.data,
            })),
        };

        const response = isNew() ?
            await api.post('/posts', data,) :
            await api.put(`/posts/${params.id}`, data,);

        endSave();

        if (response.success) {
            setSavedBlocks(structuredClone(blocks(),),);
            autoSave.clear();
            markClean();
            toast.success(`Post '${title()}' saved`,);
            // For brand-new posts, switch to the persisted id URL so
            // subsequent saves PUT instead of POST. Existing posts stay
            // on the same editor URL.
            if (isNew()) {
                const newId = (response as any).data?.id;
                if (newId) navigate(`/admin/posts/${newId}`, { replace: true, },);
            }
        } else {
            showError(response, 'Failed to save post',);
        }
    };

    return (
        <div>
            <Title>{isNew() ? 'New Post' : `Edit Post: ${title() || 'Untitled'}`} - Admin - RW</Title>
            <div class="admin-header">
                <h1>{isNew() ? 'New Post' : `Edit Post: ${title() || 'Untitled'}`}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                    <Show when={!isNew() && post()}>
                        <Show when={isDeleted()}>
                            <button
                                class="btn btn--secondary"
                                onClick={() => setShowRestoreConfirm(true,)}
                                disabled={restoring()}
                            >
                                {restoring() ? 'Restoring...' : 'Un-delete Post'}
                            </button>
                        </Show>
                        <Show when={!isDeleted() && (isDirty() || status() === 'draft')}>
                            <button class="btn btn--ghost" onClick={() => setShowPreview(true,)}>
                                Preview Changes
                            </button>
                        </Show>
                        <Show when={status() === 'published'}>
                            <a href={`/posts/${post()?.slug}`} target="_blank" class="btn btn--secondary">
                                View Post &nearr;
                            </a>
                        </Show>
                    </Show>
                    <button class="btn btn--primary" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving...' : 'Save Post'}
                    </button>
                </div>
            </div>
            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            {/* ─── Properties (open by default; brief view in header when collapsed) ─── */}
            <CollapsiblePanel
                title="Post Properties"
                defaultOpen
                headerContent={
                    <span class="editor-brief">
                        <span class={`editor-brief__title ${!title() ? 'editor-brief__title--placeholder' : ''}`}>
                            {title() || 'Untitled post'}
                        </span>
                        <Show when={slug()}>
                            <span class="editor-brief__slug">/{slug()}</span>
                        </Show>
                    </span>
                }
                headerExtra={
                    <>
                        <span class={`editor-pill editor-pill--${status()}`}>{status()}</span>
                        <span class={`editor-pill editor-pill--${accessLevel()}`}>{accessLevel()}</span>
                    </>
                }
            >
                <div class="editor-properties">
                    <div class="editor-properties__main">
                        <div class="form-group">
                            <label>Title</label>
                            <input
                                type="text"
                                value={title()}
                                onInput={(e,) => { setTitle(e.currentTarget.value,); markDirty(); }}
                                placeholder="Post title"
                            />
                        </div>
                        <div class="form-group">
                            <label>Slug</label>
                            <input
                                type="text"
                                value={slug()}
                                onInput={(e,) => { setSlug(e.currentTarget.value,); markDirty(); }}
                                placeholder="post-slug"
                            />
                            <small class="form-help">URL: /posts/{slug() || 'post-slug'}</small>
                        </div>
                        <div class="form-group">
                            <label>Excerpt</label>
                            <textarea
                                rows={3}
                                value={excerpt()}
                                onInput={(e,) => { setExcerpt(e.currentTarget.value,); markDirty(); }}
                                placeholder="Brief summary of the post..."
                            />
                        </div>
                        <div class="form-group">
                            <label>Tags</label>
                            <input
                                type="text"
                                value={tags()}
                                onInput={(e,) => { setTags(e.currentTarget.value,); markDirty(); }}
                                placeholder="tag1, tag2, tag3"
                            />
                            <small class="form-help">Comma-separated</small>
                        </div>
                    </div>
                    <div class="editor-properties__sidebar">
                        <div class="form-group">
                            <label>Status</label>
                            <select
                                value={status()}
                                onChange={(e,) => { setStatus(e.currentTarget.value,); markDirty(); }}
                            >
                                <option value="draft">Draft</option>
                                <option value="scheduled">Scheduled</option>
                                <option value="published">Published</option>
                                <option value="archived">Archived</option>
                            </select>
                        </div>
                        <Show when={status() === 'scheduled'}>
                            <div class="form-group">
                                <label>Publish At</label>
                                <input
                                    type="datetime-local"
                                    value={publishAt()}
                                    onInput={(e,) => { setPublishAt(e.currentTarget.value,); markDirty(); }}
                                />
                            </div>
                        </Show>
                        <div class="form-group">
                            <label>Access</label>
                            <select
                                value={accessLevel()}
                                onChange={(e,) => { setAccessLevel(e.currentTarget.value,); markDirty(); }}
                            >
                                <option value="public">Public</option>
                                <option value="member">Members Only</option>
                                <option value="patron">Patrons Only</option>
                            </select>
                        </div>
                    </div>
                </div>
            </CollapsiblePanel>

                <BlockEditor
                    title="Content Blocks"
                    blocks={blocks()}
                    savedBlocks={savedBlocks()}
                    onBlocksChange={(newBlocks,) => { setBlocks(newBlocks,); markDirty(); }}
                    containerStyle={siteContainerStyle()}
                    containerClass="site-preview-container"
                />

                <EditorSaveBar
                    onSave={handleSave}
                    onCancel={() => navigate('/admin/posts',)}
                    onDelete={() => setShowDeleteConfirm(true,)}
                    saving={saving()}
                    deleting={deleting()}
                    showDelete={!isNew() && !isDeleted()}
                    saveLabel="Save Post"
                    deleteLabel="Delete Post"
                />

                <Show when={!isNew()}>
                    <RevisionsPanel
                        entityType="post"
                        entityId={params.id}
                        onRestored={() => window.location.reload()}
                    />
                </Show>

            <ConfirmModal
                open={showDeleteConfirm()}
                title="Delete Post"
                message="Are you sure you want to delete this post? It will be moved to the trash and can be restored later."
                confirmLabel="Delete"
                onConfirm={async () => {
                    setShowDeleteConfirm(false,);
                    setDeleting(true,);
                    try {
                        const response = await api.put(`/posts/${params.id}`, { status: 'deleted', },);
                        if (response.success) {
                            markClean();
                            navigate('/admin/posts',);
                        } else {
                            setError((response as any).error?.message || 'Failed to delete post',);
                        }
                    } catch (err: any) {
                        setError(err.message || 'Failed to delete post',);
                    } finally {
                        setDeleting(false,);
                    }
                }}
                onCancel={() => setShowDeleteConfirm(false,)}
                danger={true}
            />
            <ConfirmModal
                open={showRestoreConfirm()}
                title="Restore Post"
                message="Are you sure you want to restore this post? It will be changed back to draft status."
                confirmLabel="Restore"
                onConfirm={async () => {
                    setShowRestoreConfirm(false,);
                    setRestoring(true,);
                    try {
                        const response = await api.put(`/posts/${params.id}`, { status: 'draft', },);
                        if (response.success) {
                            setStatus('draft',);
                            markClean();
                        } else {
                            setError((response as any).error?.message || 'Failed to restore post',);
                        }
                    } catch (err: any) {
                        setError(err.message || 'Failed to restore post',);
                    } finally {
                        setRestoring(false,);
                    }
                }}
                onCancel={() => setShowRestoreConfirm(false,)}
            />

            {/* Inline preview overlay — no navigation, preserves editor state */}
            <Show when={showPreview()}>
                <PreviewOverlay onClose={() => setShowPreview(false,)}>
                    <Header navigation={[]} siteName="RW" />
                    <main class="container" style={{ 'min-height': '70vh', 'padding-top': '2rem', }}>
                        <article style={{ 'max-width': '800px', margin: '0 auto', }}>
                            <h1 style={{ 'margin-bottom': '0.5rem', }}>{title() || 'Untitled Post'}</h1>
                            <div style={{ color: '#999', 'margin-bottom': '2rem', 'font-size': '0.9rem', }}>
                                {status() === 'draft' ? 'Draft' : 'Preview'}
                                {excerpt() ? ` — ${excerpt()}` : ''}
                            </div>
                            <Show when={blocks().length}>
                                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem', }}>
                                    <For each={blocks()}>
                                        {(block,) => {
                                            // Resolve style for preview
                                            const ref = block.data?.__styleRef || block.styleRef;
                                            let resolvedStyle: any = undefined;
                                            if (ref?.custom) {
                                                resolvedStyle = ref.custom;
                                            } else if (ref?.templateId) {
                                                const tmpl = BlockStyleService.getCached().find((s: any,) =>
                                                    s.id === ref.templateId
                                                );
                                                resolvedStyle = tmpl || undefined;
                                            }
                                            return (
                                                <PostContentBlock block={{ ...block, style: resolvedStyle, } as any} />
                                            );
                                        }}
                                    </For>
                                </div>
                            </Show>
                            <Show when={!blocks().length}>
                                <div style={{ padding: '2rem', 'text-align': 'center', color: '#999', }}>
                                    No content blocks to preview
                                </div>
                            </Show>
                        </article>
                    </main>
                </PreviewOverlay>
            </Show>
        </div>
    );
};

export default AdminPostEditor;
