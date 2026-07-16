import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import type { BlockData, } from '../../components/admin/blocks/BlockEditor';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import EntityEditorShell from '../../components/admin/editors/EntityEditorShell';
import { BlockRenderer, } from '../../components/blocks/BlockRenderer';
import { Layout, } from '../../components/layout/Layout';
import { blockDataToRenderBlock, } from '../../utils/blockData';
import { useEntityEditor, type EntitySaveContext, } from '../../hooks/useEntityEditor';
import { buildBlockTree, type Page, } from '@sitesurge/types';
import { cms, } from '../../services/cmsClient';

// Uses DEFAULT_BLOCK_TYPES from BlockEditor (unified list for all editors).
// Block IDs are real UUIDs from creation (see utils/blockId) so a group child
// can reference its parent before either is saved.

// StyleRef / style logic lives in the shared kernel so the page,
// post, and mail converters can't drift apart.
import {
    deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle,
} from '../../services/blockStyleRef';

function pageBlockToBlockData(block: any,): BlockData {
    return {
        id: block.id,
        type: block.type,
        parentBlockId: block.parentBlockId ?? null,
        sort_order: block.order ?? 0,
        data: {
            title: block.title || '',
            content: block.content || '',
            ...(block.settings || {}),
        },
        styleRef: deriveStyleRefFromStyle(block.style,),
    };
}

function blockDataToPageBlock(block: BlockData, order: number,) {
    const { title, content, __styleRef: _unused, ...settings } = block.data;

    const resolved = resolveActiveStyleRef(block.data, block.styleRef,);
    const persisted = styleRefToPersistedStyle(resolved,);
    // Pages tolerate `style: null` to wipe the column, so we preserve
    // the explicit-clear sentinel through to the wire.
    const style = persisted === undefined && resolved.explicitlyCleared ? null : persisted;

    return {
        type: block.type,
        parentBlockId: block.parentBlockId ?? null,
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
        style,
    };
}

const ALIGNMENTS = [
    { value: 'left', icon: '≡', title: 'Left', },
    { value: 'center', icon: '≡', title: 'Center', },
    { value: 'right', icon: '≡', title: 'Right', },
];

const AdminPageEditor: Component = () => {
    // ─── Page property signals (still owned here) ───
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

    // Per-block create/update/delete/reorder sync (page-specific; posts
    // embed their blocks in the save payload instead).
    const syncBlocks = async (
        pageId: string,
        currentBlocks: BlockData[],
        origIds: Set<string>,
    ) => {
        const currentIds = new Set(currentBlocks.map(b => b.id),);
        const deletedIds = [...origIds,].filter(id => !currentIds.has(id,));
        for (const id of deletedIds) {
            await cms.pages.deleteBlock(pageId, id,);
        }

        // Per-parent "order" is the block's index within its siblings.
        // Compute once up front.
        const orderByParent = new Map<string | null, number>();
        const orderById = new Map<string, number>();
        for (const b of currentBlocks) {
            const key = b.parentBlockId ?? null;
            const next = (orderByParent.get(key,) ?? -1) + 1;
            orderByParent.set(key, next,);
            orderById.set(b.id, next,);
        }

        // Walk currentBlocks linearly. The editor keeps parents before
        // their children in the flat array (groups insert their initial
        // group_item children immediately after the group itself), so a
        // single forward pass POSTs parents before children — FK
        // references against client-supplied UUIDs resolve fine.
        for (const b of currentBlocks) {
            const order = orderById.get(b.id,) ?? 0;
            const payload = blockDataToPageBlock(b, order,);
            if (origIds.has(b.id,)) {
                await cms.pages.updateBlock(pageId, b.id, payload as any,);
            } else {
                await cms.pages.createBlock(pageId, { ...payload, id: b.id, } as any,);
            }
        }

        // Per-parent reorder — keeps server-side "order" in sync with the
        // editor's current arrangement for parents that already had rows.
        const byParent = new Map<string | null, string[]>();
        for (const b of currentBlocks) {
            const key = b.parentBlockId ?? null;
            const list = byParent.get(key,) ?? [];
            list.push(b.id,);
            byParent.set(key, list,);
        }
        for (const [parentKey, ids,] of byParent.entries()) {
            const existingCount = ids.filter(id => origIds.has(id,)).length;
            if (ids.length > 1 && existingCount > 1) {
                await cms.pages.reorderBlocks(pageId, {
                    parentBlockId: parentKey,
                    blockIds: ids,
                } as any,);
            }
        }
    };

    const editor = useEntityEditor<Page>({
        entityKind: 'page',
        listPath: '/admin/pages',
        load: (id,) => cms.pages.getById(id,) as Promise<Page>,
        status,
        autoSaveState: () => ({
            title: title(),
            titleAlignment: titleAlignment(),
            slug: slug(),
            status: status(),
            accessLevel: accessLevel(),
            isHomepage: isHomepage(),
            showTitle: showTitle(),
        }),
        validate: () => {
            if (!title()) return 'Title is required';
            if (!slug()) return 'Slug is required';
            return null;
        },
        save: async (ctx: EntitySaveContext,) => {
            const data = {
                title: title(),
                titleAlignment: titleAlignment(),
                slug: slug(),
                status: status(),
                accessLevel: accessLevel(),
                isHomepage: isHomepage(),
                showTitle: showTitle(),
            };
            let pageId = ctx.id;
            if (ctx.isNew) {
                const created = await cms.pages.create(data as any,);
                pageId = (created as any).id;
            } else {
                await cms.pages.update(ctx.id, data as any,);
            }
            if (pageId) await syncBlocks(pageId, ctx.blocks, ctx.originalBlockIds,);
            return pageId;
        },
        softDelete: (id,) => cms.pages.update(id, { status: 'deleted', } as any,) as any,
        restore: (id,) => cms.pages.update(id, { status: 'draft', } as any,) as any,
        onRestored: () => setStatus('draft',),
        messages: {
            saved: () => `Page '${title()}' saved`,
            saveError: 'Failed to save page',
            deleteError: 'Failed to delete page',
            restoreError: 'Failed to restore page',
        },
    },);

    // ─── Hydrate signals from the loaded page ───
    createEffect(() => {
        const p = editor.entity();
        if (!p) return;
        setTitle(p.title || '',);
        setTitleAlignment((p as any).titleAlignment || 'left',);
        setSlug(p.slug || '',);
        setStatus(p.status || 'draft',);
        setAccessLevel(p.accessLevel || 'public',);
        // Default true preserves prior behavior for legacy rows saved
        // before this column existed (mapRow returns `undefined` for
        // missing columns).
        setShowTitle((p as any).showTitle !== false,);
        setIsHomepage(Boolean((p as any).isHomepage,),);
        const blockList = (p as any).blocks as any[] | undefined;
        if (blockList?.length) {
            const converted = blockList.map((b,) => pageBlockToBlockData(b,));
            editor.setBlocks(converted,);
            editor.setSavedBlocks(structuredClone(converted,),);
            editor.setOriginalBlockIds(new Set<string>(blockList.map((b,) => String(b.id,)),),);
        }
    },);

    const properties = (
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
                        <div class="u-flex-row">
                            <input
                                type="text"
                                value={title()}
                                onInput={(e,) => { setTitle(e.currentTarget.value,); editor.markDirty(); }}
                                placeholder="Page title"
                                style={{ flex: '1', }}
                            />
                            <div class="page-editor__align-buttons">
                                <For each={ALIGNMENTS}>
                                    {(a,) => (
                                        <button
                                            class={`page-editor__align-btn ${titleAlignment() === a.value ? 'page-editor__align-btn--active' : ''}`}
                                            onClick={() => { setTitleAlignment(a.value,); editor.markDirty(); }}
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
                            onInput={(e,) => { setSlug(e.currentTarget.value,); editor.markDirty(); }}
                            placeholder="page-slug"
                        />
                        <small class="form-help">URL: /{slug()}</small>
                    </div>
                    {/* "Show title on page" toggle — sits in the
                        same single-line layout as the homepage
                        toggle in the sidebar; reuses those classes
                        so spacing / typography stay consistent. */}
                    <div class="form-group page-editor__homepage-section">
                        <div class="page-editor__homepage-toggle">
                            <Toggle
                                checked={showTitle()}
                                onChange={(next,) => { setShowTitle(next,); editor.markDirty(); }}
                                label="Show title on page"
                            />
                            <Tooltip
                                header="Show title on page"
                                content="When on, the page renderer prints this page's title as a heading above the content blocks. Turn it off when your first block (e.g. a hero or carousel) already provides the visual headline and you don't want a duplicate."
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
                            <option value="published">Published</option>
                            <option value="archived">Archived</option>
                        </select>
                    </div>
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
                    <div class="form-group page-editor__homepage-section">
                        <Toggle
                            checked={isHomepage()}
                            onChange={(next,) => { setIsHomepage(next,); editor.markDirty(); }}
                            label="Use as homepage"
                        />
                        <small class="form-help page-editor__homepage-help">
                            Show this page at <code>/</code>. The page is still reachable at <code>/{slug() || 'slug'}</code>.
                            Must be <strong>published</strong> to appear on the public site. Only one page can be the homepage at a time.
                        </small>
                    </div>
                </div>
            </div>
        </CollapsiblePanel>
    );

    const previewBody = (
        // Wrap in the public <Layout> so the preview renders the
        // configured site header, footer, navigation, appearance vars,
        // swatches, and fonts — the same chrome a real visitor sees.
        <Layout>
            {/* Wrap in the same `.dynamic-page page-wrapper` div the
                public DynamicPage uses, so styles scoped to that
                selector apply identically in preview. */}
            <div class="dynamic-page page-wrapper">
                <Show when={title() && showTitle()}>
                    <h1
                        class="dynamic-page__title"
                        style={{ 'text-align': (titleAlignment() || 'left') as any, }}
                    >
                        {title()}
                    </h1>
                </Show>
                <For each={buildBlockTree(editor.blocks().map((b,) => blockDataToRenderBlock(b, editor.params.id,),),)}>
                    {(block,) => <BlockRenderer block={block} />}
                </For>
                <Show when={!editor.blocks().length}>
                    <div class="empty-state empty-state--plain">No content blocks to preview</div>
                </Show>
            </div>
        </Layout>
    );

    return (
        <EntityEditorShell
            editor={editor}
            revisionsEntityType="page"
            title={title}
            status={status}
            publicUrl={() => `/${(editor.entity() as any)?.slug || slug()}`}
            previewStatus={() => status() === 'published' ? 'Published' : 'Draft'}
            rootClass={(full,) => `page-editor ${full ? 'admin-full-bleed' : ''}`}
            labels={{
                newHeading: 'New Page',
                editHeading: (t,) => `Edit Page: ${t || 'Untitled'}`,
                blockEditorTitle: 'Page Content',
                saveLabel: 'Save Page',
                deleteLabel: 'Delete Page',
                previewLabel: 'Preview',
                restoreLabel: 'Restore',
                viewLabel: 'View ↗',
                deleteModalTitle: 'Delete Page',
                deleteModalMessage:
                    'Are you sure you want to delete this page? It will be moved to the trash and can be restored later.',
                restoreModalTitle: 'Restore Page',
                restoreModalMessage:
                    'Are you sure you want to restore this page? It will be changed back to draft status.',
            }}
            properties={properties}
            previewBody={previewBody}
        />
    );
};

export default AdminPageEditor;
