import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import { BlockData, } from '../../components/admin/blocks/ContentBlock';
import EntityEditorShell from '../../components/admin/editors/EntityEditorShell';
import { deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle, } from '../../services/blockStyleRef';
import MediaSelectModal from '../../components/admin/media/MediaSelectModal';
import MediaUploadModal from '../../components/admin/media/MediaUploadModal';
import { Layout, } from '../../components/layout/Layout';
import PostContentBlock from '../../components/blocks/posts/PostContentBlock';
import { useEntityEditor, type EntitySaveContext, } from '../../hooks/useEntityEditor';
import { invalidatePostsCache, } from '../../services/adminData';
import { cms, } from '../../services/cmsClient';
import { BlockStyleService, } from '../../services/blockStyles';
import { generateBlockId, } from '../../utils/blockId';
import type { Post, } from '@sitesurge/types';

const AdminPostEditor: Component = () => {
    // ─── Post property signals ───
    const [title, setTitle,] = createSignal('',);
    const [slug, setSlug,] = createSignal('',);
    const [excerpt, setExcerpt,] = createSignal('',);
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
    const [tags, setTags,] = createSignal('',);
    const [featuredImage, setFeaturedImage,] = createSignal('',);
    const [publishAt, setPublishAt,] = createSignal('',);
    const [authorId, setAuthorId,] = createSignal('',);
    /** Whether the post renderer applies the site's Post Padding (top/bottom)
     *  and/or the site gutter (left/right). Both default on. */
    const [applyPostPadding, setApplyPostPadding,] = createSignal(true,);
    const [applySiteGutter, setApplySiteGutter,] = createSignal(true,);
    /** Header color style for this post ('' → inherit the site default). */
    const [headerStyle, setHeaderStyle,] = createSignal('',);
    const [showImageSelect, setShowImageSelect,] = createSignal(false,);

    // Site default post header style — used as the displayed fallback in the
    // Header Style dropdown when this post hasn't picked one explicitly.
    const [siteDefaultPostHeaderStyle,] = createResource(async () => {
        try {
            const h = await cms.settings.getSiteHeader() as { defaultPostHeaderStyle?: 'default' | 'alt'; } | null;
            return h?.defaultPostHeaderStyle === 'alt' ? 'alt' : 'default';
        } catch {
            return 'default';
        }
    },);
    const [showImageUpload, setShowImageUpload,] = createSignal(false,);

    // Staff users (admin / sysadmin / editor) for the Author dropdown.
    const [staffUsers,] = createResource(async () => {
        try {
            return await cms.users.authors();
        } catch {
            return [] as { id: string; displayName: string; role: string; }[];
        }
    },);

    const editor = useEntityEditor<Post>({
        entityKind: 'post',
        listPath: '/admin/posts',
        load: (id,) => cms.posts.getById(id,) as Promise<Post>,
        status,
        autoSaveState: () => ({
            title: title(),
            slug: slug(),
            excerpt: excerpt(),
            status: status(),
            accessLevel: accessLevel(),
            tags: tags(),
            featuredImage: featuredImage(),
            publishAt: publishAt(),
            authorId: authorId(),
            applyPostPadding: applyPostPadding(),
            applySiteGutter: applySiteGutter(),
            headerStyle: headerStyle(),
        }),
        validate: () => {
            if (!title()) return 'Title is required';
            if (!slug()) return 'Slug is required';
            return null;
        },
        save: async (ctx: EntitySaveContext,) => {
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
                applyPostPadding: applyPostPadding(),
                applySiteGutter: applySiteGutter(),
                headerStyle: headerStyle() || undefined,
                contentBlocks: ctx.blocks.map((b, i,) => {
                    // Persist the block's style. The backend reads it from
                    // `data.__styleRef`; resolve the active ref (an explicit
                    // picker action beats the loaded value) and embed it —
                    // previously this was dropped, so styles set in the post
                    // editor never saved.
                    const resolved = resolveActiveStyleRef(b.data, b.styleRef,);
                    const persisted = styleRefToPersistedStyle(resolved,);
                    const { __styleRef: _drop, ...cleanData } = b.data as Record<string, any>;
                    const blockData: Record<string, any> = { ...cleanData, };
                    if (resolved.explicitlyCleared) {
                        // No templateId/custom → backend writes style = null.
                    } else if (persisted && typeof persisted === 'object' && 'id' in persisted) {
                        blockData.__styleRef = { templateId: (persisted as { id: string; }).id, };
                    } else if (persisted) {
                        blockData.__styleRef = { custom: persisted, };
                    }
                    return { id: b.id, type: b.type, sort_order: i, data: blockData, };
                }),
            };
            const saved = ctx.isNew
                ? await cms.posts.create(data,)
                : await cms.posts.update(ctx.id, data,);
            return (saved as any)?.id ?? ctx.id;
        },
        onSaved: () => invalidatePostsCache(),
        softDelete: (id,) => cms.posts.update(id, { status: 'deleted', } as any,) as any,
        onDeleted: () => invalidatePostsCache(),
        restore: (id,) => cms.posts.update(id, { status: 'draft', } as any,) as any,
        onRestored: () => setStatus('draft',),
        messages: {
            saved: () => `Post '${title()}' saved`,
            saveError: 'Failed to save post',
            deleteError: 'Failed to delete post',
            restoreError: 'Failed to restore post',
        },
    },);

    // ─── Offer to restore a localStorage draft for NEW posts ───
    // (only if a draft exists and the current state is empty)
    createEffect(() => {
        if (!editor.isNew()) return;
        if (title() || editor.blocks().length) return;
        const draft = editor.autoSave.getDraft();
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
            setApplyPostPadding(d.applyPostPadding !== false,);
            setApplySiteGutter(d.applySiteGutter !== false,);
            setHeaderStyle(d.headerStyle || '',);
            editor.setBlocks(d.blocks || [],);
        }
    },);

    // ─── Hydrate signals from the loaded post ───
    createEffect(() => {
        const p = editor.entity();
        if (!p) return;
        setTitle(p.title || '',);
        setSlug(p.slug || '',);
        setExcerpt(p.excerpt || '',);
        setStatus(p.status || 'draft',);
        setAccessLevel(p.accessLevel || 'public',);
        setTags((p.tags || []).join(', ',),);
        setFeaturedImage(p.featuredImage || '',);
        setAuthorId((p as any).authorId || '',);
        setApplyPostPadding((p as any).applyPostPadding !== false,);
        setApplySiteGutter((p as any).applySiteGutter !== false,);
        setHeaderStyle((p as any).headerStyle || '',);
        setPublishAt(p.publishAt ? new Date(p.publishAt,).toISOString().slice(0, 16,) : '',);
        const blockList = (p as any).contentBlocks as any[] | undefined;
        if (blockList?.length) {
            const converted = blockList.map((b,) => ({
                // b.style is the persisted style payload: either
                // `{ id: <uuid> }` (template ref) or flat custom props.
                // The shared kernel produces the editor's styleRef shape
                // from either.
                id: b.id || generateBlockId(),
                type: b.type,
                sort_order: b.sortOrder ?? b.sort_order,
                data: b.data || {},
                styleRef: deriveStyleRefFromStyle(b.style,),
            } as BlockData));
            editor.setBlocks(converted,);
            editor.setSavedBlocks(structuredClone(converted,),);
        }
    },);

    const properties = (
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
                            onInput={(e,) => { setTitle(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="Post title"
                        />
                    </div>
                    <div class="form-group">
                        <label>Slug</label>
                        <input
                            type="text"
                            value={slug()}
                            onInput={(e,) => { setSlug(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="post-slug"
                        />
                        <small class="form-help">URL: /posts/{slug() || 'post-slug'}</small>
                    </div>
                    <div class="form-group">
                        <label>Excerpt</label>
                        <textarea
                            rows={3}
                            value={excerpt()}
                            onInput={(e,) => { setExcerpt(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="Brief summary of the post..."
                        />
                    </div>
                    <div class="form-group">
                        <label>Tags</label>
                        <input
                            type="text"
                            value={tags()}
                            onInput={(e,) => { setTags(e.currentTarget.value,); editor.markDirty(); }}
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
                                        onClick={() => { setFeaturedImage('',); editor.markDirty(); }}
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
                    <div class="form-group">
                        <div class="u-flex-row" style={{ 'align-items': 'center', gap: '8px', }}>
                            <Toggle
                                checked={applyPostPadding()}
                                onChange={(next,) => { setApplyPostPadding(next,); editor.markDirty(); }}
                                label="Apply Post Padding"
                            />
                            <Tooltip
                                header="Apply Post Padding"
                                content="Apply the site's Post Padding (Settings → Appearance → Layout) to this post — primarily top/bottom. Default 0 until you set a value there."
                            />
                        </div>
                        <div class="u-flex-row" style={{ 'align-items': 'center', gap: '8px', 'margin-top': '8px', }}>
                            <Toggle
                                checked={applySiteGutter()}
                                onChange={(next,) => { setApplySiteGutter(next,); editor.markDirty(); }}
                                label="Apply Site Gutter"
                            />
                            <Tooltip
                                header="Apply Site Gutter"
                                content="Apply the site's Gutter (left/right padding) to this post's content. Turn off for a full-bleed post."
                            />
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Header Style</label>
                        <div class="u-flex-row" style={{ 'align-items': 'center', gap: '8px', }}>
                            <select
                                value={headerStyle() || (siteDefaultPostHeaderStyle() ?? 'default')}
                                onChange={(e,) => { setHeaderStyle(e.currentTarget.value,); editor.markDirty(); }}
                            >
                                <option value="default">Default</option>
                                <option value="alt">Alt</option>
                            </select>
                            <Tooltip
                                header="Header Style"
                                content="Which Site Header colors this post renders. 'Default' uses the regular Site Header background and text color; 'Alt' uses the alternative (alt) styles. Leave as-is to follow the site's Default Post Header Style."
                            />
                        </div>
                    </div>
                </div>
                <div class="editor-properties__sidebar">
                    <div class="form-group">
                        <label>Status</label>
                        <select
                            value={status()}
                            onChange={(e,) => { setStatus(e.currentTarget.value,); editor.markDirty(); }}
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
                                onInput={(e,) => { setPublishAt(e.currentTarget.value,); editor.markDirty(); }}
                            />
                        </div>
                    </Show>
                    <div class="form-group">
                        <label>Access</label>
                        <select
                            value={accessLevel()}
                            onChange={(e,) => { setAccessLevel(e.currentTarget.value,); editor.markDirty(); }}
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
                            onChange={(e,) => { setAuthorId(e.currentTarget.value,); editor.markDirty(); }}
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
    );

    const previewBody = (
        // Wrap in the public <Layout> so the preview shows the configured
        // site header, footer, navigation, appearance vars, swatches, and
        // fonts.
        <Layout>
            {/* Match the public Post page wrapper so scoped styles apply
                identically in preview. */}
            <div class="post-page page-wrapper">
                <article style={{ 'max-width': 'var(--site-max-width, 800px)', margin: '0 auto', padding: '2rem 1rem', }}>
                    <h1 style={{ 'margin-bottom': '0.5rem', }}>{title() || 'Untitled Post'}</h1>
                    <div style={{ color: 'var(--admin-text-muted, #6b7280)', 'margin-bottom': '2rem', 'font-size': '0.9rem', }}>
                        {status() === 'draft' ? 'Draft' : 'Preview'}
                        {excerpt() ? ` — ${excerpt()}` : ''}
                    </div>
                    <Show when={editor.blocks().length}>
                        <div class="u-flex-col u-gap-md">
                            <For each={editor.blocks()}>
                                {(block,) => {
                                    // Resolve style for preview
                                    const ref = block.data?.__styleRef || block.styleRef;
                                    let resolvedStyle: any = undefined;
                                    if (ref?.custom) {
                                        resolvedStyle = ref.custom;
                                    } else if (ref?.templateId) {
                                        const tmpl = BlockStyleService.getCached().find((s: any,) => s.id === ref.templateId,);
                                        resolvedStyle = tmpl || undefined;
                                    }
                                    return <PostContentBlock block={{ ...block, style: resolvedStyle, } as any} />;
                                }}
                            </For>
                        </div>
                    </Show>
                    <Show when={!editor.blocks().length}>
                        <div class="empty-state empty-state--plain">No content blocks to preview</div>
                    </Show>
                </article>
            </div>
        </Layout>
    );

    const extraModals = (
        <>
            <Show when={showImageSelect()}>
                <MediaSelectModal
                    types={['image',]}
                    onSelect={(media,) => {
                        setFeaturedImage(media.url,);
                        editor.markDirty();
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
                        editor.markDirty();
                        setShowImageUpload(false,);
                    }}
                    onClose={() => setShowImageUpload(false,)}
                />
            </Show>
        </>
    );

    return (
        <EntityEditorShell
            editor={editor}
            revisionsEntityType="post"
            title={title}
            status={status}
            publicUrl={() => `/posts/${(editor.entity() as any)?.slug || slug()}`}
            previewStatus={() =>
                status() === 'published' ? 'Published' : status() === 'archived' ? 'Archived' : 'Draft'}
            rootClass={(full,) => full ? 'admin-full-bleed' : ''}
            labels={{
                newHeading: 'New Post',
                editHeading: (t,) => `Edit Post: ${t || 'Untitled'}`,
                blockEditorTitle: 'Content Blocks',
                saveLabel: 'Save Post',
                deleteLabel: 'Delete Post',
                previewLabel: 'Preview Changes',
                restoreLabel: 'Un-delete Post',
                viewLabel: 'View Post ↗',
                deleteModalTitle: 'Delete Post',
                deleteModalMessage:
                    'Are you sure you want to delete this post? It will be moved to the trash and can be restored later.',
                restoreModalTitle: 'Restore Post',
                restoreModalMessage:
                    'Are you sure you want to restore this post? It will be changed back to draft status.',
            }}
            properties={properties}
            previewBody={previewBody}
            extraModals={extraModals}
        />
    );
};

export default AdminPostEditor;
