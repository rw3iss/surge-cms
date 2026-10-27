import { isFeatureEnabled, reloadSiteSettings, siteSettings, } from '../../stores/siteSettings';
import { NotFoundError, } from '@sitesurge/client';
import { availableSystemPages, buildBlockTree, getSystemPage, SYSTEM_PAGES, type Page, } from '@sitesurge/types';

const systemPageLabel = (key: string,) => getSystemPage(key,)?.label ?? key;
import { useNavigate, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import ColorPicker from '../../components/admin/appearance/ColorPicker';
import type { BlockData, } from '../../components/admin/blocks/BlockEditor';
import AlignButtons, { type HAlign, } from '../../components/admin/common/AlignButtons';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
import CssEditor from '../../components/admin/common/CssEditor';
import Toggle from '../../components/admin/common/Toggle';
import Tooltip from '../../components/admin/common/Tooltip';
import EntityEditorShell from '../../components/admin/editors/EntityEditorShell';
import { FormField, } from '../../components/admin/forms';
import { BlockRenderer, } from '../../components/blocks/BlockRenderer';
import { useToast, } from '../../components/common/toast';
import { Layout, } from '../../components/layout/Layout';
import { type EntitySaveContext, useEntityEditor, } from '../../hooks/useEntityEditor';
import { planBlockSync, } from '../../services/blockSyncPlan';
import { cms, } from '../../services/cmsClient';
import { contentPaddingStyle, pageBackgroundStyle, } from '../../utils/appearanceStyle';
import { blockDataToRenderBlock, } from '../../utils/blockData';

// Uses DEFAULT_BLOCK_TYPES from BlockEditor (unified list for all editors).
// Block IDs are real UUIDs from creation (see utils/blockId) so a group child
// can reference its parent before either is saved.

// StyleRef / style logic lives in the shared kernel so the page,
// post, and mail converters can't drift apart.
import {
    deriveStyleRefFromStyle,
    resolveActiveStyleRef,
    styleRefToPersistedStyle,
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

const AdminPageEditor: Component = () => {
    // ─── Page property signals (still owned here) ───
    const [title, setTitle,] = createSignal('',);
    const [titleAlignment, setTitleAlignment,] = createSignal('left',);
    const [slug, setSlug,] = createSignal('',);
    /** Whether the page renderer prints the page title above the
     *  content blocks. Default true so new pages get the title for
     *  free; the operator can opt out per page. */
    const [showTitle, setShowTitle,] = createSignal(true,);
    /** Whether the page renderer applies the site's Page Padding (top/bottom)
     *  and/or the site gutter (left/right). Both default on. */
    const [applyPagePadding, setApplyPagePadding,] = createSignal(true,);
    const [applySiteGutter, setApplySiteGutter,] = createSignal(true,);
    /** Header color style for this page ('' → 'default'). */
    const [headerStyle, setHeaderStyle,] = createSignal('',);
    /** Header position for this page ('' = '-' → inherit site default). */
    const [headerPosition, setHeaderPosition,] = createSignal('',);
    const [backgroundColor, setBackgroundColor,] = createSignal('',);
    const [customCss, setCustomCss,] = createSignal('',);
    const [showCss, setShowCss,] = createSignal(false,);
    /** Tab behaviour for the code editors; from Settings → Appearance. */
    const codeTabWidth = () =>
        ((editor.appearance() as { codeTabWidth?: '4' | '2' | 'tab'; } | null)?.codeTabWidth) ?? '4';
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
    /** Subscription-required mode: members without a subscription may still open this page. */
    const [openAccess, setOpenAccess,] = createSignal(false,);
    // "Use as page": the built-in screen this page replaces (SYSTEM_PAGES key —
    // 'home' = the site root), '' = None. One page per key; saving takes it over
    // from any other page and the save reports which one.
    const [systemPage, setSystemPage,] = createSignal('',);
    const toast = useToast();
    /** Core options + those whose feature is on (a page already set to one stays listed). */
    const systemPageOptions = () => availableSystemPages(isFeatureEnabled,).concat(
        SYSTEM_PAGES.filter((p,) => p.key === systemPage() && p.feature && !isFeatureEnabled(p.feature,),),
    );
    /** Another PUBLISHED page holding the chosen key (drafts are reported after the save). */
    const currentHolder = () => {
        const held = systemPage() ? siteSettings()?.systemPages?.[systemPage()] : undefined;
        return held && held !== (editor.saved() as Page | null)?.slug ? held : null;
    };

    // Per-block create/update/delete/reorder sync (page-specific; posts
    // embed their blocks in the save payload instead).
    const syncBlocks = async (
        pageId: string,
        currentBlocks: BlockData[],
        savedBlocks: BlockData[],
        origIds: Set<string>,
    ) => {
        const plan = planBlockSync({
            current: currentBlocks,
            saved: savedBlocks,
            origIds,
            serialize: blockDataToPageBlock,
        },);

        for (const id of plan.deletes) {
            try {
                await cms.pages.deleteBlock(pageId, id,);
            } catch (err) {
                // A 404 means the block is already gone — e.g. it was a child of
                // a block we just deleted (the backend cascade-removes children),
                // or it was removed in an earlier save. That's the desired end
                // state, so don't let it fail the whole page save.
                if (!(err instanceof NotFoundError)) throw err;
            }
        }

        // Parents precede children in the flat array, so this single forward
        // pass POSTs parents before children (client UUIDs let FK references
        // resolve).
        const byId = new Map(currentBlocks.map(b => [b.id, b,] as const),);
        for (const w of plan.writes) {
            const block = byId.get(w.id,);
            if (!block) continue;
            const payload = blockDataToPageBlock(block, w.order,);
            if (w.isNew) {
                await cms.pages.createBlock(pageId, { ...payload, id: w.id, } as any,);
            } else {
                await cms.pages.updateBlock(pageId, w.id, payload as any,);
            }
        }

        // Atomic per-parent renumber for any sibling group whose sequence moved.
        // Runs AFTER the writes so newly created rows already exist and pass the
        // backend's "these blocks belong to this parent" check.
        for (const r of plan.reorders) {
            await cms.pages.reorderBlocks(pageId, {
                parentBlockId: r.parentBlockId,
                blockIds: r.blockIds,
            } as any,);
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
            openAccess: openAccess(),
            systemPage: systemPage(),
            showTitle: showTitle(),
            applyPagePadding: applyPagePadding(),
            applySiteGutter: applySiteGutter(),
            headerStyle: headerStyle(),
            headerPosition: headerPosition(),
            backgroundColor: backgroundColor(),
            customCss: customCss(),
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
                openAccess: openAccess(),
                systemPage: systemPage() || null,
                showTitle: showTitle(),
                applyPagePadding: applyPagePadding(),
                applySiteGutter: applySiteGutter(),
                headerStyle: headerStyle() || undefined,
                // '' is meaningful: it CLEARS the colour back to the site
                // default, so it must reach the server rather than dropping out.
                headerPosition: headerPosition() || undefined,
                backgroundColor: backgroundColor(),
                customCss: customCss(),
            };
            let pageId = ctx.id;
            const before = (editor.saved() as Page | null)?.systemPage ?? null;
            const statusBefore = (editor.saved() as Page | null)?.status;
            const saved = (ctx.isNew ? await cms.pages.create(data as any,) : await cms.pages.update(ctx.id, data as any,)) as Page;
            if (ctx.isNew) pageId = saved.id;
            if (saved?.systemPageReplaced) {
                toast.info(`'${saved.systemPageReplaced.title}' was the ${systemPageLabel(systemPage(),)} page — it is set back to None.`,);
            }
            // The public settings carry the assignments (previews + the public routes).
            if ((data.systemPage ?? null) !== before || data.status !== statusBefore) void reloadSiteSettings();
            ctx.commit(saved as unknown as Record<string, unknown>,);
            // On a brand-new page nothing is saved yet, so diff against an
            // empty snapshot → every block is created.
            if (pageId) {
                await syncBlocks(pageId, ctx.blocks, ctx.isNew ? [] : ctx.savedBlocks, ctx.originalBlockIds,);
            }
            return pageId;
        },
        snapshot: (id,) => cms.pages.snapshotRevision(id,),
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

    /** Apply a locally-saved draft (fields + blocks) over the server-hydrated
     *  state. `savedBlocks`/`originalBlockIds` stay as the SERVER state so the
     *  save reconcile still knows what's actually persisted; only the CURRENT
     *  (unsaved) `blocks` + fields come from the draft. */
    const applyDraft = (d: Record<string, any>,) => {
        if (d.title != null) setTitle(d.title,);
        if (d.titleAlignment != null) setTitleAlignment(d.titleAlignment,);
        if (d.slug != null) setSlug(d.slug,);
        if (d.status != null) setStatus(d.status,);
        if (d.accessLevel != null) setAccessLevel(d.accessLevel,);
        if (d.openAccess != null) setOpenAccess(d.openAccess === true,);
        if (d.showTitle != null) setShowTitle(d.showTitle !== false,);
        if (d.applyPagePadding != null) setApplyPagePadding(d.applyPagePadding !== false,);
        if (d.applySiteGutter != null) setApplySiteGutter(d.applySiteGutter !== false,);
        if (d.headerStyle != null) setHeaderStyle(d.headerStyle,);
        if (d.headerPosition != null) setHeaderPosition(d.headerPosition,);
        if (d.backgroundColor != null) setBackgroundColor(d.backgroundColor,);
        if (d.customCss != null) setCustomCss(d.customCss,);
        if (d.systemPage != null) setSystemPage(String(d.systemPage,),);
        else if (d.isHomepage != null) setSystemPage(d.isHomepage ? 'home' : '',);
        if (Array.isArray(d.blocks,)) editor.setBlocks(d.blocks as BlockData[],);
    };

    // ─── Hydrate signals from the loaded page ───
    createEffect(() => {
        const p = editor.entity();
        if (!p) return;
        // While the next one loads (the editor is reused across :id), the
        // resource still holds the PREVIOUS entity — never hydrate that into
        // the new URL's editor.
        if ((p as any).id && editor.params.id && (p as any).id !== editor.params.id) return;
        setTitle(p.title || '',);
        setTitleAlignment((p as any).titleAlignment || 'left',);
        setSlug(p.slug || '',);
        setStatus(p.status || 'draft',);
        setAccessLevel(p.accessLevel || 'public',);
        setOpenAccess(p.openAccess === true,);
        // Default true preserves prior behavior for legacy rows saved
        // before this column existed (mapRow returns `undefined` for
        // missing columns).
        setShowTitle((p as any).showTitle !== false,);
        setApplyPagePadding((p as any).applyPagePadding !== false,);
        setApplySiteGutter((p as any).applySiteGutter !== false,);
        setHeaderStyle((p as any).headerStyle || '',);
        setHeaderPosition((p as any).headerPosition || '',);
        setBackgroundColor((p as any).backgroundColor || '',);
        setCustomCss((p as any).customCss || '',);
        setSystemPage(p.systemPage || (p.isHomepage ? 'home' : ''),);
        const blockList = (p as any).blocks as any[] | undefined;
        if (blockList?.length) {
            const converted = blockList.map((b,) => pageBlockToBlockData(b,));
            editor.setBlocks(converted,);
            editor.setSavedBlocks(structuredClone(converted,),);
            editor.setOriginalBlockIds(new Set<string>(blockList.map((b,) => String(b.id,)),),);
        }

        // Draft restore: if a locally-saved draft is NEWER than the server
        // version (i.e. unsaved edits from before a reload / a failed save),
        // load it over the server content so nothing is lost. A real save
        // clears the draft; a draft older than the server version is stale and
        // discarded.
        const draft = editor.autoSave.getDraft();
        if (draft) {
            const serverUpdated = new Date((p as any).updatedAt || 0,).getTime();
            if (draft.timestamp > serverUpdated + 1000) {
                applyDraft(draft.data as Record<string, any>,);
                toast.info('Restored your unsaved draft for this page.',);
            } else {
                editor.autoSave.clear(); // stale draft — page was saved since
            }
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
                    <Show when={systemPage()}>
                        <span class="editor-pill editor-pill--homepage">{systemPageLabel(systemPage(),)}</span>
                    </Show>
                    <span class={`editor-pill editor-pill--${status()}`}>{status()}</span>
                    <span class={`editor-pill editor-pill--${accessLevel()}`}>{accessLevel()}</span>
                </>
            }
        >
            <div class="editor-properties">
                <div class="editor-properties__main">
                    <FormField label="Title">
                        <div class="u-flex-row">
                            <input
                                type="text"
                                value={title()}
                                onInput={(e,) => {
                                    setTitle(e.currentTarget.value,);
                                    editor.markDirty();
                                }}
                                placeholder="Page title"
                                style={{ flex: '1', }}
                            />
                            <AlignButtons
                                label="Title alignment"
                                value={(titleAlignment() || 'left') as HAlign}
                                onChange={(v,) => {
                                    setTitleAlignment(v,);
                                    editor.markDirty();
                                }}
                            />
                        </div>
                    </FormField>
                    <FormField label="Slug">
                        <input
                            type="text"
                            value={slug()}
                            onInput={(e,) => {
                                setSlug(e.currentTarget.value,);
                                editor.markDirty();
                            }}
                            placeholder="page-slug"
                        />
                        <small class="form-help">URL: /{slug()}</small>
                    </FormField>
                    {
                        /* "Show title on page" toggle — sits in the
                        same single-line layout as the homepage
                        toggle in the sidebar; reuses those classes
                        so spacing / typography stay consistent. */
                    }
                    <div class="form-group page-editor__homepage-section">
                        <FormField
                            label="Use as page"
                            tooltip="Show this page in place of a built-in page, at that page's address. One page per built-in page."
                        >
                            <select
                                value={systemPage()}
                                onChange={(e,) => { setSystemPage(e.currentTarget.value,); editor.markDirty(); }}
                            >
                                <option value="">None</option>
                                <For each={systemPageOptions()}>
                                    {(o,) => <option value={o.key}>{o.label} ({o.path})</option>}
                                </For>
                            </select>
                        </FormField>
                        <small class="form-help page-editor__homepage-help">
                            <Show
                                when={systemPage()}
                                fallback={<>An ordinary page at <code>/{slug() || 'slug'}</code>.</>}
                            >
                                Shown at <code>{getSystemPage(systemPage(),)?.path}</code> instead of the built-in page, and still at{' '}
                                <code>/{slug() || 'slug'}</code>. Must be <strong>published</strong> to appear.
                                <Show when={currentHolder()}>
                                    {' '}<strong>/{currentHolder()}</strong> is the {systemPageLabel(systemPage(),)} page now — saving replaces it (it goes back to None).
                                </Show>
                            </Show>
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
            {
                /* Wrap in the same `.dynamic-page page-wrapper` div the
                public DynamicPage uses, so styles scoped to that
                selector apply identically in preview — INCLUDING the
                padding override. `.page-wrapper` carries a hard-coded
                gutter + top/bottom padding; the public page cancels it
                per the page's own toggles, and the preview skipping that
                is why it showed padding on a page configured to have
                none. */
            }
            <div
                class="dynamic-page page-wrapper"
                style={contentPaddingStyle('--site-page-padding', applyPagePadding(), applySiteGutter(),)}
            >
                <Show when={title() && showTitle()}>
                    <h1
                        class="dynamic-page__title"
                        style={{ 'text-align': (titleAlignment() || 'left') as any, }}
                    >
                        {title()}
                    </h1>
                </Show>
                <For each={buildBlockTree(editor.blocks().map((b,) => blockDataToRenderBlock(b, editor.params.id,)),)}>
                    {(block,) => <BlockRenderer block={block} />}
                </For>
                <Show when={!editor.blocks().length}>
                    <div class="empty-state empty-state--plain">No content blocks to preview</div>
                </Show>
            </div>
        </Layout>
    );

    const navigate = useNavigate();

    /**
     * Duplicate this page and open the copy.
     *
     * Naming is requested explicitly rather than left to the copy endpoint's
     * automatic `-1` suffix: "Home (Copy)" / "home-copy" is what an operator
     * expects to find in the list. The server still collision-checks, so a
     * second clone becomes "home-copy-1" instead of failing.
     */
    const handleClone = async () => {
        const current = editor.entity() as { id?: string; title?: string; slug?: string; } | undefined;
        const id = current?.id;
        if (!id) return;
        const baseTitle = current?.title || title() || 'Untitled';
        const baseSlug = current?.slug || slug();
        try {
            const copy = await cms.entities.copy('page', id, {
                title: `${baseTitle} (Copy)`,
                ...(baseSlug ? { slug: `${baseSlug}-copy`, } : {}),
                // A copy starts as a draft: publishing is a decision, and an
                // exact duplicate of a live page appearing on the site the
                // moment someone clicks Clone is never what was meant.
                status: 'draft',
            },) as { id?: string; };
            if (copy?.id) navigate(`/admin/pages/${copy.id}`,);
        } catch (err) {
            toast.error(`Could not clone this page: ${(err as Error).message}`,);
        }
    };

    return (
        <EntityEditorShell
            containerStyleExtra={() => pageBackgroundStyle(backgroundColor(),)}
            editor={editor}
            revisionsEntityType="page"
            title={title}
            status={status}
            publicUrl={() => `/${(editor.saved() as any)?.slug || slug()}`}
            previewStatus={() => status() === 'published' ? 'Published' : 'Draft'}
            rootClass={() => 'page-editor admin-full-bleed'}
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
            onClone={handleClone}
            cloneLabel="Clone"
        />
    );
};

export default AdminPageEditor;
