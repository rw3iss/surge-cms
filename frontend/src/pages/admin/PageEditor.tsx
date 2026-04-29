import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import AutoSaveIndicator from '../../components/admin/AutoSaveIndicator';
import BlockEditor, { BlockData, } from '../../components/admin/BlockEditor';
import CollapsiblePanel from '../../components/admin/CollapsiblePanel';
import ConfirmModal from '../../components/admin/ConfirmModal';
import EditorSaveBar from '../../components/admin/EditorSaveBar';
import PreviewOverlay from '../../components/admin/PreviewOverlay';
import RevisionsPanel from '../../components/admin/RevisionsPanel';
import Tooltip from '../../components/admin/Tooltip';
import { BlockRenderer, } from '../../components/BlockRenderer';
import { Header, } from '../../components/Layout/Header';
import { useToast, } from '../../components/Toast';
import { useAutoSave, } from '../../hooks/useAutoSave';
import { useEditorState, } from '../../hooks/useEditorState';
import { useKeyboardShortcuts, } from '../../hooks/useKeyboardShortcuts';
import { useUnsavedChanges, } from '../../hooks/useUnsavedChanges';
import type { AppearanceSettings, } from '@rw/shared';
import { api, fetchAppearance, } from '../../services/api';
import { BlockStyleService, } from '../../services/blockStyles';
import { appearanceCssVars, } from '../../utils/appearanceStyle';

// Uses DEFAULT_BLOCK_TYPES from BlockEditor (unified list for all editors).

let blockIdCounter = 0;
const generateBlockId = () => `block-${Date.now()}-${++blockIdCounter}`;

function pageBlockToBlockData(block: any,): BlockData {
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

function blockDataToPageBlock(block: BlockData, order: number,) {
    const { title, content, __styleRef, ...settings } = block.data;
    let style: any = undefined;
    // Detect explicit "clear" via __styleRef being present but null/empty
    const hasExplicitStyleRef = '__styleRef' in block.data;
    const explicitlyCleared = hasExplicitStyleRef && (__styleRef === null || __styleRef === undefined);
    const ref = hasExplicitStyleRef ? __styleRef : block.styleRef;

    if (ref?.templateId) {
        style = { id: ref.templateId, };
    } else if (ref?.custom) {
        const { id: _id, name: _name, isDefault: _d, createdAt: _ca, updatedAt: _ua, ...customProps } = ref.custom;
        style = Object.keys(customProps,).length > 0 ? customProps : undefined;
    }

    return {
        type: block.type,
        // Send title/content directly. Empty string = user cleared the
        // field and the backend should write '' (the previous version
        // coerced '' to undefined, which JSON dropped, so the old value
        // stuck around). undefined still drops via JSON for new blocks
        // that never had a title.
        title: title ?? undefined,
        content: content ?? undefined,
        settings: Object.keys(settings,).length > 0 ? settings : {},
        order,
        isVisible: true,
        // Send null explicitly when cleared so the backend wipes the style column
        style: style ?? (explicitlyCleared ? null : undefined),
    };
}

const ALIGNMENTS = [
    { value: 'left', icon: '\u2261', title: 'Left', },
    { value: 'center', icon: '\u2261', title: 'Center', },
    { value: 'right', icon: '\u2261', title: 'Right', },
];

const AdminPageEditor: Component = () => {
    const params = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => !params.id || params.id === 'new';
    const { isDirty, markDirty, markClean, } = useUnsavedChanges();

    const [page,] = createResource(() => isNew() ? null : params.id, async (id,) => {
        if (!id) return null;
        const response = await api.get(`/pages/${id}`,);
        return response.success ? (response as any).data : null;
    },);

    // Load site appearance settings for the preview container
    const [appearance,] = createResource(async () => {
        const response = await fetchAppearance();
        return response.success ? response.data as AppearanceSettings : null;
    },);

    /**
     * Build inline styles that mirror what Layout.tsx applies to the
     * public site. The block preview container uses 'public' mode so
     * the WYSIWYG matches the live site (admin chrome around it gets
     * its own vars from AdminLayout).
     */
    const siteContainerStyle = () => appearanceCssVars(appearance(), 'public',);

    const [title, setTitle,] = createSignal('',);
    const [titleAlignment, setTitleAlignment,] = createSignal('left',);
    const [slug, setSlug,] = createSignal('',);
    /** Whether the page renderer prints the page title above the
     *  content blocks. Default true so new pages get the title for
     *  free; the operator can opt out per page. */
    const [showTitle, setShowTitle,] = createSignal(true,);
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
    // Whether this page is the site's homepage. The slug stays a normal
    // string (still required, still URL-safe) — we use this flag rather
    // than overloading the slug to mean "/" or empty. Only one page can
    // be the homepage at a time; the backend clears the flag on others
    // when this page saves with isHomepage=true.
    const [isHomepage, setIsHomepage,] = createSignal(false,);
    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    const [originalBlockIds, setOriginalBlockIds,] = createSignal<Set<string>>(new Set(),);
    const { error, saving, beginSave, endSave, showError, setError, } = useEditorState();
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
            setTitleAlignment(p.titleAlignment || 'left',);
            setSlug(p.slug || '',);
            setStatus(p.status || 'draft',);
            setAccessLevel(p.accessLevel || 'public',);
            // Default true preserves prior behavior for legacy rows
            // saved before this column existed (mapRow returns
            // `undefined` for missing columns).
            setShowTitle((p as any).showTitle !== false,);
            setIsHomepage(Boolean((p as any).isHomepage,),);
            if (p.blocks?.length) {
                const converted = p.blocks.map((b: any,) => pageBlockToBlockData(b,));
                setBlocks(converted,);
                setSavedBlocks(structuredClone(converted,),);
                setOriginalBlockIds(new Set<string>(p.blocks.map((b: any,) => String(b.id,)),),);
            }
        }
    },);

    const syncBlocks = async (pageId: string,) => {
        const currentBlocks = blocks();
        const origIds = originalBlockIds();
        const currentIds = new Set(currentBlocks.map(b => b.id),);
        const deletedIds = [...origIds,].filter(id => !currentIds.has(id,));
        const newBlocks = currentBlocks.filter(b => !origIds.has(b.id,));
        const existingBlocks = currentBlocks.filter(b => origIds.has(b.id,));

        for (const id of deletedIds) {
            await api.delete(`/pages/${pageId}/blocks/${id}`,);
        }
        for (let i = 0; i < newBlocks.length; i++) {
            const b = newBlocks[i];
            const order = currentBlocks.indexOf(b,);
            await api.post(`/pages/${pageId}/blocks`, blockDataToPageBlock(b, order,),);
        }
        for (const b of existingBlocks) {
            const order = currentBlocks.indexOf(b,);
            await api.put(`/pages/${pageId}/blocks/${b.id}`, blockDataToPageBlock(b, order,),);
        }
        const blockIds = currentBlocks.filter(b => origIds.has(b.id,)).map(b => b.id);
        if (blockIds.length > 1) {
            await api.put(`/pages/${pageId}/blocks/reorder`, { blockIds, },);
        }
    };

    // Auto-save draft to localStorage
    const autoSave = useAutoSave({
        key: `page-draft-${params.id || 'new'}`,
        state: () => ({
            title: title(),
            titleAlignment: titleAlignment(),
            slug: slug(),
            status: status(),
            accessLevel: accessLevel(),
            isHomepage: isHomepage(),
            showTitle: showTitle(),
            blocks: blocks(),
        }),
    },);

    const handleSave = async () => {
        if (!title()) { setError('Title is required',); return; }
        if (!slug()) { setError('Slug is required',); return; }

        beginSave();
        try {
            const data = {
                title: title(),
                titleAlignment: titleAlignment(),
                slug: slug(),
                status: status(),
                accessLevel: accessLevel(),
                isHomepage: isHomepage(),
                showTitle: showTitle(),
            };

            let pageId = params.id;
            if (isNew()) {
                const response = await api.post('/pages', data,);
                if (!response.success) {
                    showError(response, 'Failed to create page',);
                    endSave();
                    return;
                }
                pageId = (response as any).data.id;
            } else {
                const response = await api.put(`/pages/${params.id}`, data,);
                if (!response.success) {
                    showError(response, 'Failed to save page',);
                    endSave();
                    return;
                }
            }

            if (pageId) await syncBlocks(pageId,);
            setSavedBlocks(structuredClone(blocks(),),);
            autoSave.clear();
            markClean();
            toast.success(`Page '${title()}' saved`,);
            // For brand-new pages we still need to navigate so the URL
            // reflects the persisted id (otherwise subsequent saves
            // re-POST instead of PUT). Existing pages stay put.
            if (isNew() && pageId) {
                navigate(`/admin/pages/${pageId}`, { replace: true, },);
            }
        } catch (err: any) {
            showError(err, 'Failed to save page',);
        } finally {
            endSave();
        }
    };

    useKeyboardShortcuts([
        { key: 's', ctrl: true, handler: () => handleSave(), },
    ],);

    return (
        <div class="page-editor">
            <Title>{isNew() ? 'New Page' : `Edit Page: ${title() || 'Untitled'}`} - Admin - RW</Title>

            <div class="admin-header">
                <h1>{isNew() ? 'New Page' : `Edit Page: ${title() || 'Untitled'}`}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={autoSave.status()} lastSavedAt={autoSave.lastSavedAt()} />
                    <Show when={!isNew() && page()}>
                        <Show when={isDeleted()}>
                            <button
                                class="btn btn--secondary btn--small"
                                onClick={() => setShowRestoreConfirm(true,)}
                                disabled={restoring()}
                            >
                                {restoring() ? 'Restoring...' : 'Restore'}
                            </button>
                        </Show>
                        <Show when={!isDeleted() && (isDirty() || status() === 'draft')}>
                            <button class="btn btn--ghost btn--small" onClick={() => setShowPreview(true,)}>
                                Preview
                            </button>
                        </Show>
                        <Show when={status() === 'published'}>
                            <a href={`/${page()?.slug}`} target="_blank" class="btn btn--secondary btn--small">
                                View &nearr;
                            </a>
                        </Show>
                    </Show>
                    <button class="btn btn--primary btn--small" onClick={handleSave} disabled={saving()}>
                        {saving() ? 'Saving...' : 'Save Page'}
                    </button>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            {/* ─── Properties (open by default; brief view in header when collapsed) ─── */}
            <CollapsiblePanel
                title="Page Properties"
                defaultOpen
                headerContent={
                    <span class="editor-brief">
                        <span class={`editor-brief__title ${!title() ? 'editor-brief__title--placeholder' : ''}`}>
                            {title() || 'Untitled page'}
                        </span>
                        <Show when={slug()}>
                            <span class="editor-brief__slug">/{slug()}</span>
                        </Show>
                    </span>
                }
                headerExtra={
                    <>
                        <Show when={isHomepage()}>
                            <span class="editor-pill editor-pill--homepage">Homepage</span>
                        </Show>
                        <span class={`editor-pill editor-pill--${status()}`}>{status()}</span>
                        <span class={`editor-pill editor-pill--${accessLevel()}`}>{accessLevel()}</span>
                    </>
                }
            >
                <div class="editor-properties">
                    <div class="editor-properties__main">
                        <div class="form-group">
                            <label>Title</label>
                            <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', }}>
                                <input
                                    type="text"
                                    value={title()}
                                    onInput={(e,) => { setTitle(e.currentTarget.value,); markDirty(); }}
                                    placeholder="Page title"
                                    style={{ flex: '1', }}
                                />
                                <div class="page-editor__align-buttons">
                                    <For each={ALIGNMENTS}>
                                        {(a,) => (
                                            <button
                                                class={`page-editor__align-btn ${titleAlignment() === a.value ? 'page-editor__align-btn--active' : ''}`}
                                                onClick={() => { setTitleAlignment(a.value,); markDirty(); }}
                                                title={a.title}
                                            >
                                                <svg viewBox="0 0 16 16" width="14" height="14">
                                                    <Show when={a.value === 'left'}>
                                                        <rect x="1" y="2" width="14" height="2" fill="currentColor" />
                                                        <rect x="1" y="7" width="10" height="2" fill="currentColor" />
                                                        <rect x="1" y="12" width="12" height="2" fill="currentColor" />
                                                    </Show>
                                                    <Show when={a.value === 'center'}>
                                                        <rect x="1" y="2" width="14" height="2" fill="currentColor" />
                                                        <rect x="3" y="7" width="10" height="2" fill="currentColor" />
                                                        <rect x="2" y="12" width="12" height="2" fill="currentColor" />
                                                    </Show>
                                                    <Show when={a.value === 'right'}>
                                                        <rect x="1" y="2" width="14" height="2" fill="currentColor" />
                                                        <rect x="5" y="7" width="10" height="2" fill="currentColor" />
                                                        <rect x="3" y="12" width="12" height="2" fill="currentColor" />
                                                    </Show>
                                                </svg>
                                            </button>
                                        )}
                                    </For>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Slug</label>
                            <input
                                type="text"
                                value={slug()}
                                onInput={(e,) => { setSlug(e.currentTarget.value,); markDirty(); }}
                                placeholder="page-slug"
                            />
                            <small class="form-help">URL: /{slug()}</small>
                        </div>
                        {/* "Show title on page" toggle — sits in the
                            same single-line layout as the homepage
                            toggle in the sidebar; reuses those classes
                            so spacing / typography stay consistent. */}
                        <div class="form-group page-editor__homepage-section">
                            <label class="page-editor__homepage-toggle">
                                <input
                                    type="checkbox"
                                    checked={showTitle()}
                                    onChange={(e,) => { setShowTitle(e.currentTarget.checked,); markDirty(); }}
                                />
                                <span class="page-editor__homepage-toggle-label">Show title on page</span>
                                <Tooltip
                                    header="Show title on page"
                                    content="When on, the page renderer prints this page's title as a heading above the content blocks. Turn it off when your first block (e.g. a hero or carousel) already provides the visual headline and you don't want a duplicate."
                                />
                            </label>
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
                                <option value="published">Published</option>
                                <option value="archived">Archived</option>
                            </select>
                        </div>
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
                        <div class="form-group page-editor__homepage-section">
                            {/* Single-line toggle: checkbox left, label right.
                                Help text wraps below on its own line so the
                                toggle row stays scannable. */}
                            <label class="page-editor__homepage-toggle">
                                <input
                                    type="checkbox"
                                    checked={isHomepage()}
                                    onChange={(e,) => { setIsHomepage(e.currentTarget.checked,); markDirty(); }}
                                />
                                <span class="page-editor__homepage-toggle-label">Use as homepage</span>
                            </label>
                            <small class="form-help page-editor__homepage-help">
                                Show this page at <code>/</code>. The page is still reachable at <code>/{slug() || 'slug'}</code>.
                                Must be <strong>published</strong> to appear on the public site. Only one page can be the homepage at a time.
                            </small>
                        </div>
                    </div>
                </div>
            </CollapsiblePanel>

            {/* ─── Block Editor ─── */}
            <BlockEditor
                title="Page Content"
                blocks={blocks()}
                savedBlocks={savedBlocks()}
                onBlocksChange={(newBlocks,) => { setBlocks(newBlocks,); markDirty(); }}
                containerStyle={siteContainerStyle()}
                containerClass="site-preview-container"
            />

            {/* ─── Bottom save bar ─── */}
            <EditorSaveBar
                onSave={handleSave}
                onCancel={() => navigate('/admin/pages',)}
                onDelete={() => setShowDeleteConfirm(true,)}
                saving={saving()}
                deleting={deleting()}
                showDelete={!isNew() && !isDeleted()}
                saveLabel="Save Page"
                deleteLabel="Delete Page"
            />

            <Show when={!isNew()}>
                <RevisionsPanel
                    entityType="page"
                    entityId={params.id}
                    onRestored={() => window.location.reload()}
                />
            </Show>

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
                        if (response.success) { markClean(); navigate('/admin/pages',); }
                        else setError((response as any).error?.message || 'Failed to delete page',);
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
                        if (response.success) { setStatus('draft',); markClean(); }
                        else setError((response as any).error?.message || 'Failed to restore page',);
                    } catch (err: any) {
                        setError(err.message || 'Failed to restore page',);
                    } finally {
                        setRestoring(false,);
                    }
                }}
                onCancel={() => setShowRestoreConfirm(false,)}
            />

            <Show when={showPreview()}>
                <PreviewOverlay backUrl="" onClose={() => setShowPreview(false,)}>
                    <Header navigation={[]} siteName="RW" />
                    <main style={{ 'min-height': '70vh', }}>
                        <For each={blocks()}>
                            {(block,) => {
                                const { title: t, content: c, __styleRef, ...rest } = block.data || {};
                                const ref = (__styleRef as any) || block.styleRef;
                                let resolvedStyle: any = undefined;
                                if (ref?.custom) resolvedStyle = ref.custom;
                                else if (ref?.templateId) {
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
