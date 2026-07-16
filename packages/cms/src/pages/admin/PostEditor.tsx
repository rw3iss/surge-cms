import { Title, } from '@solidjs/meta';
import { useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/common/AutoSaveIndicator';
import BlockEditor from '../../components/admin/blocks/BlockEditor';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import { BlockData, } from '../../components/admin/blocks/ContentBlock';
import { deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle, } from '../../services/blockStyleRef';
import EditorSaveBar from '../../components/admin/common/EditorSaveBar';
import PreviewOverlay from '../../components/admin/common/PreviewOverlay';
import MediaSelectModal from '../../components/admin/media/MediaSelectModal';
import MediaUploadModal from '../../components/admin/media/MediaUploadModal';
import RevisionsPanel from '../../components/admin/panels/RevisionsPanel';
import { Layout, } from '../../components/layout/Layout';
import PostContentBlock from '../../components/blocks/posts/PostContentBlock';
import { useToast, } from '../../components/common/toast';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import { invalidatePostsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';
import { BlockStyleService, } from '../../services/blockStyles';
import { appearanceCssVars, } from '../../utils/appearanceStyle';
import { generateBlockId, } from '../../utils/blockId';
import { useAppearance, } from '../../hooks/useAppearance';

const AdminPostEditor: Component = () => {
    const params = useParams<{ id: string, }>();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => !params.id || params.id === 'new';
    const { isDirty, markDirty, markClean, } = useUnsavedChanges();

    const [post,] = createResource(() => isNew() ? null : params.id, async (id,) => {
        if (!id) return null;
        try {
            return await cms.posts.getById(id,);
        } catch {
            return null;
        }
    },);

    // Load site appearance for the preview container
    const appearance = useAppearance();

    // Staff users (admin / sysadmin / editor) for the Author dropdown.
    const [staffUsers,] = createResource(async () => {
        try {
            return await cms.users.authors();
        } catch {
            return [] as { id: string; displayName: string; role: string; }[];
        }
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
    const [featuredImage, setFeaturedImage,] = createSignal('',);
    const [showImageSelect, setShowImageSelect,] = createSignal(false,);
    const [showImageUpload, setShowImageUpload,] = createSignal(false,);
    const [publishAt, setPublishAt,] = createSignal('',);
    const [authorId, setAuthorId,] = createSignal('',);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    const { error, saving, beginSave, endSave, showError, setError, } = useEditorState();
    const [showDeleteConfirm, setShowDeleteConfirm,] = createSignal(false,);
    const [showRestoreConfirm, setShowRestoreConfirm,] = createSignal(false,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [restoring, setRestoring,] = createSignal(false,);
    // Full-bleed mode: driven by the block editor's full-width toggle;
    // adds `.admin-full-bleed` to remove the centered 1400px content cap.
    const [fullBleed, setFullBleed,] = createSignal(false,);
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
            featuredImage: featuredImage(),
            publishAt: publishAt(),
            authorId: authorId(),
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
            setFeaturedImage(d.featuredImage || '',);
            setPublishAt(d.publishAt || '',);
            setAuthorId(d.authorId || '',);
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
            setFeaturedImage(p.featuredImage || '',);
            setAuthorId((p as any).authorId || '',);
            if (p.publishAt) {
                setPublishAt(new Date(p.publishAt,).toISOString().slice(0, 16,),);
            } else {
                setPublishAt('',);
            }
            if (p.contentBlocks?.length) {
                const converted = p.contentBlocks.map((b: any,) => {
                    // b.style is the persisted style payload: either
                    // `{ id: <uuid> }` (template ref) or flat custom
                    // props. The shared kernel produces the editor's
                    // styleRef shape from either.
                    return {
                        id: b.id || generateBlockId(),
                        type: b.type,
                        sort_order: b.sortOrder ?? b.sort_order,
                        data: b.data || {},
                        styleRef: deriveStyleRefFromStyle(b.style,),
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
            featuredImage: featuredImage() || null,
            authorId: authorId() || null,
            publishAt: publishAt() ? new Date(publishAt(),).toISOString() : null,
            contentBlocks: blocks().map((b, i,) => {
                // Persist the block's style. The backend reads it from
                // `data.__styleRef`; mirror the page editor by resolving the
                // active ref (an explicit picker action beats the loaded
                // value) and embedding it — previously this was dropped, so
                // styles set in the post editor never saved.
                const resolved = resolveActiveStyleRef(b.data, b.styleRef,);
                const persisted = styleRefToPersistedStyle(resolved,);
                const { __styleRef: _drop, ...cleanData } = b.data as Record<string, any>;
                const data: Record<string, any> = { ...cleanData, };
                if (resolved.explicitlyCleared) {
                    // No templateId/custom → backend writes style = null.
                } else if (persisted && typeof persisted === 'object' && 'id' in persisted) {
                    data.__styleRef = { templateId: (persisted as { id: string; }).id, };
                } else if (persisted) {
                    data.__styleRef = { custom: persisted, };
                }
                return {
                    id: b.id,
                    type: b.type,
                    sort_order: i,
                    data,
                };
            }),
        };

        try {
            const saved = isNew() ?
                await cms.posts.create(data,) :
                await cms.posts.update(params.id, data,);

            setSavedBlocks(structuredClone(blocks(),),);
            autoSave.clear();
            markClean();
            invalidatePostsCache();
            toast.success(`Post '${title()}' saved`,);
            // For brand-new posts, switch to the persisted id URL so
            // subsequent saves PUT instead of POST. Existing posts stay
            // on the same editor URL.
            if (isNew()) {
                const newId = (saved as any)?.id;
                if (newId) navigate(`/admin/posts/${newId}`, { replace: true, },);
            }
        } catch (e) {
            showError(e, 'Failed to save post',);
        } finally {
            endSave();
        }
    };

    return (
        <div class={fullBleed() ? 'admin-full-bleed' : undefined}>
            <Title>{isNew() ? 'New Post' : `Edit Post: ${title() || 'Untitled'}`} - Admin - RW</Title>
            <div class="admin-header admin-header--sticky">
                <h1>{isNew() ? 'New Post' : `Edit Post: ${title() || 'Untitled'}`}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                    <Show when={!isNew() && post()}>
                        <Show when={isDeleted()}>
                            <button
                                class="btn btn--secondary btn--small"
                                onClick={() => setShowRestoreConfirm(true,)}
                                disabled={restoring()}
                            >
                                {restoring() ? 'Restoring...' : 'Un-delete Post'}
                            </button>
                        </Show>
                        <Show when={!isDeleted() && (isDirty() || status() === 'draft')}>
                            <button class="btn btn--ghost btn--small" onClick={() => setShowPreview(true,)}>
                                Preview Changes
                            </button>
                        </Show>
                        <Show when={status() === 'published'}>
                            <a href={`/posts/${post()?.slug}`} target="_blank" class="btn btn--secondary btn--small">
                                View Post &nearr;
                            </a>
                        </Show>
                    </Show>
                    <button class="btn btn--primary btn--small" onClick={handleSave} disabled={saving()}>
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
                        <div class="form-group">
                            <label>Banner Image</label>
                            <div class="post-banner-field">
                                <Show when={featuredImage()}>
                                    <img
                                        class="post-banner-field__preview"
                                        src={featuredImage()}
                                        alt="Banner preview"
                                    />
                                </Show>
                                <div class="post-banner-field__actions">
                                    <button
                                        type="button"
                                        class="btn btn--small btn--secondary"
                                        onClick={() => setShowImageSelect(true,)}
                                    >
                                        Select Media
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn--small btn--outline"
                                        onClick={() => setShowImageUpload(true,)}
                                    >
                                        Upload New
                                    </button>
                                    <Show when={featuredImage()}>
                                        <button
                                            type="button"
                                            class="btn btn--small btn--danger"
                                            onClick={() => { setFeaturedImage('',); markDirty(); }}
                                            title="Remove banner image"
                                        >
                                            Remove
                                        </button>
                                    </Show>
                                </div>
                            </div>
                            <small class="form-help">
                                Used as the top &ldquo;banner image&rdquo; on the post.
                            </small>
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
                        <div class="form-group">
                            <label>Author</label>
                            <select
                                value={authorId()}
                                onChange={(e,) => { setAuthorId(e.currentTarget.value,); markDirty(); }}
                            >
                                <option value="">—</option>
                                <For each={staffUsers() || []}>
                                    {(u,) => <option value={u.id}>{u.displayName}</option>}
                                </For>
                            </select>
                            <small class="form-help">Staff user credited as the post's author.</small>
                        </div>
                    </div>
                </div>
            </CollapsiblePanel>

                <BlockEditor
                    title="Content Blocks"
                    blocks={blocks()}
                    savedBlocks={savedBlocks()}
                    onBlocksChange={(newBlocks,) => { setBlocks(newBlocks,); markDirty(); }}
                    onFullWidthChange={setFullBleed}
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
                        await cms.posts.update(params.id, { status: 'deleted', } as any,);
                        markClean();
                        invalidatePostsCache();
                        navigate('/admin/posts',);
                    } catch (err: any) {
                        // Modal hides the form's error banner — use a toast so
                        // the message actually surfaces.
                        toast.error(err?.message || 'Failed to delete post',);
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
                        await cms.posts.update(params.id, { status: 'draft', } as any,);
                        setStatus('draft',);
                        markClean();
                    } catch (err: any) {
                        toast.error(err?.message || 'Failed to restore post',);
                    } finally {
                        setRestoring(false,);
                    }
                }}
                onCancel={() => setShowRestoreConfirm(false,)}
            />

            {/* Inline preview overlay — no navigation, preserves editor state */}
            <Show when={showPreview()}>
                <PreviewOverlay
                    onClose={() => setShowPreview(false,)}
                    title={title() || 'Untitled post'}
                    status={status() === 'published' ? 'Published' : status() === 'archived' ? 'Archived' : 'Draft'}
                >
                    {/* Wrap in the public <Layout> so the preview shows
                        the configured site header, footer, navigation,
                        appearance vars, swatches, and fonts. */}
                    <Layout>
                        {/* Match the public Post page wrapper so scoped
                            styles apply identically in preview. */}
                        <div class="post-page page-wrapper">
                        <article style={{ 'max-width': '800px', margin: '0 auto', padding: '2rem 1rem', }}>
                            <h1 style={{ 'margin-bottom': '0.5rem', }}>{title() || 'Untitled Post'}</h1>
                            <div style={{ color: 'var(--admin-text-muted, #6b7280)', 'margin-bottom': '2rem', 'font-size': '0.9rem', }}>
                                {status() === 'draft' ? 'Draft' : 'Preview'}
                                {excerpt() ? ` — ${excerpt()}` : ''}
                            </div>
                            <Show when={blocks().length}>
                                <div class="u-flex-col u-gap-md">
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
                                <div class="empty-state empty-state--plain">No content blocks to preview</div>
                            </Show>
                        </article>
                        </div>
                    </Layout>
                </PreviewOverlay>
            </Show>

            <Show when={showImageSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        setFeaturedImage(media.url,);
                        markDirty();
                        setShowImageSelect(false,);
                    }}
                    onClose={() => setShowImageSelect(false,)}
                />
            </Show>
            <Show when={showImageUpload()}>
                <MediaUploadModal
                    acceptTypes="image/*"
                    onUploaded={(media,) => {
                        setFeaturedImage(media.url,);
                        markDirty();
                        setShowImageUpload(false,);
                    }}
                    onClose={() => setShowImageUpload(false,)}
                />
            </Show>
        </div>
    );
};

export default AdminPostEditor;
