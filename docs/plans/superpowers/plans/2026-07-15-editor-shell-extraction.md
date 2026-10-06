# Editor Shell Extraction — Implementation Plan

> **For agentic workers:** Execute this with **superpowers:subagent-driven-development**. Each task below is an independent, buildable increment — dispatch one subagent per task, verify its green build before starting the next, and commit between tasks.

**Goal:** Extract the ~90% duplicated admin editor shell shared by `PageEditor.tsx` and `PostEditor.tsx` into a reusable `useEntityEditor(...)` lifecycle hook plus an `<EntityEditorShell>` layout component, leaving each editor as a thin field-definition + save-payload module.

**Architecture:** `useEntityEditor` owns every cross-cutting concern — the `createResource(entity)`, dirty tracking, save state, block/savedBlocks/originalBlockIds signals, full-bleed flag, preview/delete/restore modal state, appearance-derived container style, `useAutoSave`, `useKeyboardShortcuts(Ctrl+S)`, and the orchestrated `handleSave`/`handleDelete`/`handleRestore` actions — and returns a typed controller. `<EntityEditorShell>` consumes that controller and renders the sticky header (AutoSaveIndicator + Preview/View/Save), the `EditorSaveBar`, `RevisionsPanel`, the two `ConfirmModal`s, the `BlockEditor`, and the `PreviewOverlay` wrapper, exposing JSX slots (`properties`, `previewBody`, `extraModals`) plus a small `labels` object for the per-entity copy. The only entity-specific logic left in `PageEditor`/`PostEditor` is: property-field signals + inputs, the load→signals hydration effect, `validate()`, the `save()` closure (page = per-block sync calls; post = embedded `contentBlocks` array), and the preview body markup.

**Tech Stack:** SolidJS (`solid-js`, `@solidjs/router`, `@solidjs/meta`), TypeScript. Bundled by Vite; package `@sitesurge/admin` (dir `packages/cms`).

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `packages/cms/src/hooks/useEntityEditor.ts` | **Create** | Generic lifecycle hook. Owns resource, dirty, save-state, blocks/savedBlocks/originalBlockIds, fullBleed, preview/delete/restore signals, appearance + `siteContainerStyle`, `useAutoSave`, `useKeyboardShortcuts`, and `handleSave`/`handleDelete`/`handleRestore`. Returns a typed `EntityEditorController`. Config-driven via `UseEntityEditorConfig` (per-entity `load`/`save`/`validate`/`softDelete`/`restore`/copy). |
| `packages/cms/src/components/admin/editors/EntityEditorShell.tsx` | **Create** | Layout component. Renders `<Title>`, sticky `admin-header`, error alert, `properties` slot, `BlockEditor`, `EditorSaveBar`, `RevisionsPanel`, delete/restore `ConfirmModal`s, and the `PreviewOverlay` wrapping the `previewBody` slot. Props = `{ editor, labels, title, status, publicUrl, previewStatus, rootClass, blockEditorTitle, revisionsEntityType, properties, previewBody, extraModals? }`. |
| `packages/cms/src/pages/admin/PageEditor.tsx` | **Modify** | Becomes thin: page field signals + inputs, `pageBlockToBlockData`/`blockDataToPageBlock`, `syncBlocks`, hydration effect, `validate`/`save` closures, page preview body, all wired through `useEntityEditor` + `<EntityEditorShell>`. |
| `packages/cms/src/pages/admin/PostEditor.tsx` | **Modify** | Becomes thin: post field signals + inputs, banner-image modals, staff-authors resource, localStorage draft-restore effect, hydration effect, `validate`/`save` (embeds `contentBlocks`), post preview body, wired through `useEntityEditor` + `<EntityEditorShell>`. |

**Note on verification:** Vite/esbuild transpiles but does **not** type-check. `pnpm --filter @sitesurge/admin run build` therefore validates bundling, import resolution, and JSX syntax — a green build proves the modules wire together and nothing is left dangling. Full type safety comes from `pnpm --filter @sitesurge/admin run lint` (oxlint flags unused imports/vars after code removal). Because unimported files are tree-shaken out of the bundle, the new hook/shell are first *exercised* by the build in **Task 2** (PageEditor migration); Task 1 verifies only that the repo still builds and lints clean.

---

## Task 1: Create `useEntityEditor` hook + `<EntityEditorShell>` component

The hook and shell are interdependent (the shell's props type references the controller the hook returns), so they land together.

**Files:**
- Create `packages/cms/src/hooks/useEntityEditor.ts`
- Create `packages/cms/src/components/admin/editors/EntityEditorShell.tsx`

### Steps

- [ ] **Step 1 — write `useEntityEditor.ts`.** Paste the following. Signatures mirror the existing hooks exactly (`useAutoSave` returns `{ status, lastSavedAt, getDraft, hasDraft, clear, flush }`; `useEditorState` returns `{ error, saving, beginSave, endSave, showError, setError, ... }`; `useUnsavedChanges` returns `{ isDirty, markDirty, markClean }`).

```ts
import { useNavigate, useParams, type Navigator, } from '@solidjs/router';
import {
    type Accessor, createResource, createSignal, type Resource, type Setter,
} from 'solid-js';
import type { AppearanceSettings, } from '@sitesurge/types';
import type { BlockData, } from '../components/admin/blocks/ContentBlock';
import { useToast, } from '../components/common/toast';
import { appearanceCssVars, } from '../utils/appearanceStyle';
import { useAppearance, } from './useAppearance';
import { useAutoSave, } from './useAutoSave';
import { useEditorState, } from './useEditorState';
import { useKeyboardShortcuts, } from './useKeyboardShortcuts';
import { useUnsavedChanges, } from './useUnsavedChanges';

/** Context handed to the entity module's `save()` at save time. */
export interface EntitySaveContext {
    isNew: boolean;
    /** The current route id (`params.id`); may be `'new'` when `isNew`. */
    id: string;
    blocks: BlockData[];
    originalBlockIds: Set<string>;
}

export interface UseEntityEditorConfig<TEntity,> {
    /** Autosave key prefix + `<kind>-draft-<id>` — e.g. 'page' | 'post'. */
    entityKind: string;
    /** Admin list route the create-redirect appends the new id to, e.g. '/admin/pages'. */
    listPath: string;
    /** Fetch the entity by id (returns null for new / on failure). */
    load: (id: string,) => Promise<TEntity | null>;
    /** Module status signal — drives `isDeleted` (status() === 'deleted'). */
    status: () => string;
    /** Entity field snapshot for the localStorage draft (hook appends `blocks`). */
    autoSaveState: () => Record<string, unknown>;
    /** Return an error string to block the save, or null to proceed. */
    validate: () => string | null;
    /** Persist the entity (create/update + any block sync). Returns the persisted id. */
    save: (ctx: EntitySaveContext,) => Promise<string | undefined>;
    /** Non-toast side effects after a successful save (e.g. cache invalidation). */
    onSaved?: () => void;
    /** Soft-delete (status → 'deleted'). */
    softDelete: (id: string,) => Promise<void>;
    /** Non-toast side effects after a successful delete (e.g. cache invalidation). */
    onDeleted?: () => void;
    /** Restore (status → 'draft'). */
    restore: (id: string,) => Promise<void>;
    /** Side effect after a successful restore (module sets its status signal to 'draft'). */
    onRestored?: () => void;
    /** Toast + banner copy. `saved` is called at save time (closes over the title signal). */
    messages: {
        saved: () => string;
        saveError: string;
        deleteError: string;
        restoreError: string;
    };
}

export interface EntityEditorController<TEntity,> {
    params: { id: string; };
    navigate: Navigator;
    isNew: () => boolean;
    entity: Resource<TEntity | null>;
    // dirty tracking
    isDirty: Accessor<boolean>;
    markDirty: () => void;
    markClean: () => void;
    // save state
    error: Accessor<string>;
    saving: Accessor<boolean>;
    setError: (msg: string,) => void;
    // block signals
    blocks: Accessor<BlockData[]>;
    setBlocks: Setter<BlockData[]>;
    savedBlocks: Accessor<BlockData[]>;
    setSavedBlocks: Setter<BlockData[]>;
    originalBlockIds: Accessor<Set<string>>;
    setOriginalBlockIds: Setter<Set<string>>;
    // full-bleed
    fullBleed: Accessor<boolean>;
    setFullBleed: Setter<boolean>;
    // preview / delete / restore modal state
    showPreview: Accessor<boolean>;
    setShowPreview: Setter<boolean>;
    showDeleteConfirm: Accessor<boolean>;
    setShowDeleteConfirm: Setter<boolean>;
    showRestoreConfirm: Accessor<boolean>;
    setShowRestoreConfirm: Setter<boolean>;
    deleting: Accessor<boolean>;
    restoring: Accessor<boolean>;
    isDeleted: () => boolean;
    // appearance
    appearance: Resource<AppearanceSettings | null>;
    siteContainerStyle: () => Record<string, string>;
    // autosave
    autoSave: ReturnType<typeof useAutoSave>;
    // actions
    handleSave: () => Promise<void>;
    handleDelete: () => Promise<void>;
    handleRestore: () => Promise<void>;
}

/**
 * Owns the admin editor lifecycle shared by PageEditor and PostEditor:
 * resource load, dirty tracking, save state, block signals, autosave,
 * Ctrl+S, and the save/delete/restore orchestration. The per-entity
 * property fields and save-payload shape live in the calling module.
 */
export function useEntityEditor<TEntity,>(
    config: UseEntityEditorConfig<TEntity>,
): EntityEditorController<TEntity> {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const toast = useToast();
    const isNew = () => !params.id || params.id === 'new';

    const { isDirty, markDirty, markClean, } = useUnsavedChanges();

    const [entity,] = createResource(
        () => isNew() ? null : params.id,
        async (id,) => {
            if (!id) return null;
            try {
                return await config.load(id,);
            } catch {
                return null;
            }
        },
    );

    const appearance = useAppearance();
    const siteContainerStyle = () => appearanceCssVars(appearance(), 'public',);

    const [blocks, setBlocks,] = createSignal<BlockData[]>([],);
    const [savedBlocks, setSavedBlocks,] = createSignal<BlockData[]>([],);
    const [originalBlockIds, setOriginalBlockIds,] = createSignal<Set<string>>(new Set(),);

    const { error, saving, beginSave, endSave, showError, setError, } = useEditorState();

    const [showDeleteConfirm, setShowDeleteConfirm,] = createSignal(false,);
    const [showRestoreConfirm, setShowRestoreConfirm,] = createSignal(false,);
    const [showPreview, setShowPreview,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [restoring, setRestoring,] = createSignal(false,);
    const [fullBleed, setFullBleed,] = createSignal(false,);
    const isDeleted = () => config.status() === 'deleted';

    // Autosave: the module supplies its field snapshot; the hook merges in blocks.
    const autoSave = useAutoSave({
        key: `${config.entityKind}-draft-${params.id || 'new'}`,
        state: () => ({ ...config.autoSaveState(), blocks: blocks(), }),
    },);

    const handleSave = async () => {
        const validationError = config.validate();
        if (validationError) { setError(validationError,); return; }

        beginSave();
        try {
            const id = await config.save({
                isNew: isNew(),
                id: params.id,
                blocks: blocks(),
                originalBlockIds: originalBlockIds(),
            },);
            setSavedBlocks(structuredClone(blocks(),),);
            autoSave.clear();
            markClean();
            config.onSaved?.();
            toast.success(config.messages.saved(),);
            // Brand-new entities navigate to the persisted id so the next
            // save PUTs instead of POSTing; existing entities stay put.
            if (isNew() && id) {
                navigate(`${config.listPath}/${id}`, { replace: true, },);
            }
        } catch (err) {
            showError(err, config.messages.saveError,);
        } finally {
            endSave();
        }
    };

    const handleDelete = async () => {
        setShowDeleteConfirm(false,);
        setDeleting(true,);
        try {
            await config.softDelete(params.id,);
            markClean();
            config.onDeleted?.();
            navigate(config.listPath,);
        } catch (err: any) {
            // The modal hides the form's error banner — surface via toast.
            toast.error(err?.message || config.messages.deleteError,);
        } finally {
            setDeleting(false,);
        }
    };

    const handleRestore = async () => {
        setShowRestoreConfirm(false,);
        setRestoring(true,);
        try {
            await config.restore(params.id,);
            config.onRestored?.();
            markClean();
        } catch (err: any) {
            toast.error(err?.message || config.messages.restoreError,);
        } finally {
            setRestoring(false,);
        }
    };

    useKeyboardShortcuts([
        { key: 's', ctrl: true, handler: () => handleSave(), },
    ],);

    return {
        params,
        navigate,
        isNew,
        entity,
        isDirty,
        markDirty,
        markClean,
        error,
        saving,
        setError,
        blocks,
        setBlocks,
        savedBlocks,
        setSavedBlocks,
        originalBlockIds,
        setOriginalBlockIds,
        fullBleed,
        setFullBleed,
        showPreview,
        setShowPreview,
        showDeleteConfirm,
        setShowDeleteConfirm,
        showRestoreConfirm,
        setShowRestoreConfirm,
        deleting,
        restoring,
        isDeleted,
        appearance,
        siteContainerStyle,
        autoSave,
        handleSave,
        handleDelete,
        handleRestore,
    };
}
```

> **Parity notes baked in above:** autosave key format `` `${entityKind}-draft-${params.id || 'new'}` `` reproduces both `page-draft-*` and `post-draft-*`; `handleSave` preserves the exact ordering (setSavedBlocks → autoSave.clear → markClean → onSaved side-effect → toast → conditional navigate); `handleDelete` keeps `markClean()` **before** `onDeleted()`/navigate (matches PostEditor's `markClean(); invalidatePostsCache(); navigate(...)`); `handleRestore` calls `onRestored()` (which sets status to 'draft') then `markClean()`.

- [ ] **Step 2 — write `EntityEditorShell.tsx`.** Paste the following. It renders the shared chrome and takes JSX slots for the per-entity parts.

```tsx
import { Title, } from '@solidjs/meta';
import { Component, JSX, Show, } from 'solid-js';
import AutoSaveIndicator from '../common/AutoSaveIndicator';
import BlockEditor from '../blocks/BlockEditor';
import ConfirmModal from '../common/ConfirmModal';
import EditorSaveBar from '../common/EditorSaveBar';
import PreviewOverlay from '../common/PreviewOverlay';
import RevisionsPanel from '../panels/RevisionsPanel';
import type { RevisionEntityType, } from '@sitesurge/types';
import type { EntityEditorController, } from '../../../hooks/useEntityEditor';

export interface EntityEditorLabels {
    /** Heading + <Title> when creating, e.g. 'New Page'. */
    newHeading: string;
    /** Heading + <Title> when editing; receives the current title signal value. */
    editHeading: (title: string,) => string;
    /** BlockEditor panel title, e.g. 'Page Content'. */
    blockEditorTitle: string;
    saveLabel: string;     // 'Save Page'
    deleteLabel: string;   // 'Delete Page'
    previewLabel: string;  // 'Preview' | 'Preview Changes'
    restoreLabel: string;  // 'Restore' | 'Un-delete Post'
    viewLabel: string;     // 'View ↗' | 'View Post ↗'
    deleteModalTitle: string;
    deleteModalMessage: string;
    restoreModalTitle: string;
    restoreModalMessage: string;
}

export interface EntityEditorShellProps<TEntity,> {
    editor: EntityEditorController<TEntity>;
    labels: EntityEditorLabels;
    /** Current entity title signal (for headings + <Title>). */
    title: () => string;
    /** Current status signal (drives View/Preview visibility). */
    status: () => string;
    /** Public URL for the View link, e.g. `/${slug()}` or `/posts/${slug()}`. */
    publicUrl: () => string;
    /** Human status shown on the preview bar, e.g. 'Published' | 'Draft'. */
    previewStatus: () => string;
    /** Root element class given the current full-bleed flag. */
    rootClass: (fullBleed: boolean,) => string;
    revisionsEntityType: RevisionEntityType;
    /** The CollapsiblePanel of property fields. */
    properties: JSX.Element;
    /** Body rendered inside the PreviewOverlay. */
    previewBody: JSX.Element;
    /** Optional extra modals (e.g. post banner media pickers). */
    extraModals?: JSX.Element;
}

/**
 * Shared admin editor chrome for entities with a block editor
 * (pages, posts). Wraps the sticky header, properties slot, block
 * editor, save bar, revisions, delete/restore modals, and preview
 * overlay around a `useEntityEditor` controller.
 */
export function EntityEditorShell<TEntity,>(
    props: EntityEditorShellProps<TEntity>,
): JSX.Element {
    const e = props.editor;
    const heading = () => e.isNew() ? props.labels.newHeading : props.labels.editHeading(props.title(),);

    return (
        <div class={props.rootClass(e.fullBleed(),)}>
            <Title>{heading()} - Admin - RW</Title>

            <div class="admin-header admin-header--sticky">
                <h1>{heading()}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={e.autoSave.status()} lastSavedAt={e.autoSave.lastSavedAt()} />
                    <Show when={!e.isNew() && e.entity()}>
                        <Show when={e.isDeleted()}>
                            <button
                                class="btn btn--secondary btn--small"
                                onClick={() => e.setShowRestoreConfirm(true,)}
                                disabled={e.restoring()}
                            >
                                {e.restoring() ? 'Restoring...' : props.labels.restoreLabel}
                            </button>
                        </Show>
                        <Show when={!e.isDeleted() && (e.isDirty() || props.status() === 'draft')}>
                            <button class="btn btn--ghost btn--small" onClick={() => e.setShowPreview(true,)}>
                                {props.labels.previewLabel}
                            </button>
                        </Show>
                        <Show when={props.status() === 'published'}>
                            <a href={props.publicUrl()} target="_blank" class="btn btn--secondary btn--small">
                                {props.labels.viewLabel}
                            </a>
                        </Show>
                    </Show>
                    <button class="btn btn--primary btn--small" onClick={e.handleSave} disabled={e.saving()}>
                        {e.saving() ? 'Saving...' : props.labels.saveLabel}
                    </button>
                </div>
            </div>

            <Show when={e.error()}>
                <div class="alert alert--error">{e.error()}</div>
            </Show>

            {props.properties}

            <BlockEditor
                title={props.labels.blockEditorTitle}
                blocks={e.blocks()}
                savedBlocks={e.savedBlocks()}
                onBlocksChange={(newBlocks,) => { e.setBlocks(newBlocks,); e.markDirty(); }}
                onFullWidthChange={e.setFullBleed}
                containerStyle={e.siteContainerStyle()}
                containerClass="site-preview-container"
            />

            <EditorSaveBar
                onSave={e.handleSave}
                onCancel={() => e.navigate(`/admin/${props.revisionsEntityType}s`,)}
                onDelete={() => e.setShowDeleteConfirm(true,)}
                saving={e.saving()}
                deleting={e.deleting()}
                showDelete={!e.isNew() && !e.isDeleted()}
                saveLabel={props.labels.saveLabel}
                deleteLabel={props.labels.deleteLabel}
            />

            <Show when={!e.isNew()}>
                <RevisionsPanel
                    entityType={props.revisionsEntityType}
                    entityId={e.params.id}
                    onRestored={() => window.location.reload()}
                />
            </Show>

            <ConfirmModal
                open={e.showDeleteConfirm()}
                title={props.labels.deleteModalTitle}
                message={props.labels.deleteModalMessage}
                confirmLabel="Delete"
                onConfirm={e.handleDelete}
                onCancel={() => e.setShowDeleteConfirm(false,)}
                danger={true}
            />
            <ConfirmModal
                open={e.showRestoreConfirm()}
                title={props.labels.restoreModalTitle}
                message={props.labels.restoreModalMessage}
                confirmLabel="Restore"
                onConfirm={e.handleRestore}
                onCancel={() => e.setShowRestoreConfirm(false,)}
            />

            <Show when={e.showPreview()}>
                <PreviewOverlay
                    backUrl=""
                    onClose={() => e.setShowPreview(false,)}
                    title={props.title() || `Untitled ${props.revisionsEntityType}`}
                    status={props.previewStatus()}
                >
                    {props.previewBody}
                </PreviewOverlay>
            </Show>

            {props.extraModals}
        </div>
    );
}

export default EntityEditorShell;
```

> **Parity notes:** `onCancel` navigates to `/admin/pages` or `/admin/posts` via `` `/admin/${revisionsEntityType}s` `` (both current editors use exactly those paths). The `EditorSaveBar` and `RevisionsPanel` props are unchanged. `PreviewOverlay` always gets `backUrl=""` — harmless because `onClose` is set and `PreviewOverlay` prefers `onClose`. The preview `title` fallback (`Untitled page`/`Untitled post`) is reconstructed from `revisionsEntityType`.

- [ ] **Step 3 — lint the two new files** (catches unused imports and obvious mistakes now, before consumers exist):

```bash
pnpm --filter @sitesurge/admin run lint
```
Expected: no new errors referencing `useEntityEditor.ts` or `EntityEditorShell.tsx` (pre-existing warnings elsewhere are unchanged).

- [ ] **Step 4 — confirm the repo still builds** (the new files are tree-shaken out until Task 2, so this only proves no regression):

```bash
pnpm --filter @sitesurge/admin run build
```
Expected: `vite build` completes, exit code 0, `dist/` written.

- [ ] **Step 5 — commit:**

```bash
git add packages/cms/src/hooks/useEntityEditor.ts \
        packages/cms/src/components/admin/editors/EntityEditorShell.tsx
git commit -m "feat(admin): useEntityEditor hook + EntityEditorShell (unwired)"
```

---

## Task 2: Migrate `PageEditor` onto the shell

First real consumer — this build compiles and bundles the hook + shell for the first time.

**Files:**
- Modify `packages/cms/src/pages/admin/PageEditor.tsx` (replace lines 84–564, the `AdminPageEditor` component; keep the top-of-file helpers `pageBlockToBlockData` (37–50), `blockDataToPageBlock` (52–76), and `ALIGNMENTS` (78–82) — they stay).

### Steps

- [ ] **Step 1 — trim imports.** Replace the import block (lines 1–35) with the reduced set. The shell now owns `AutoSaveIndicator`, `BlockEditor`, `ConfirmModal`, `EditorSaveBar`, `PreviewOverlay`, `RevisionsPanel`, and the four lifecycle hooks, so drop those imports; keep what the page body still uses (`CollapsiblePanel`, `Toggle`, `Tooltip`, `BlockRenderer`, `Layout`, `blockDataToRenderBlock`, `buildBlockTree`, `cms`, style-ref helpers). Add the new hook + shell imports. Keep `BlockData` (type only) from `BlockEditor`.

```tsx
import { A, } from '@solidjs/router';
import { Component, createEffect, For, Show, } from 'solid-js';
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
import {
    deriveStyleRefFromStyle, resolveActiveStyleRef, styleRefToPersistedStyle,
} from '../../services/blockStyleRef';
```

> `A` is retained only if still referenced; if lint flags it as unused after the rewrite, delete it. `deriveStyleRefFromStyle` is used by `pageBlockToBlockData`, so it stays. The `Title`, `useNavigate`, `useParams`, `createResource`, `createSignal`, `useToast`, and the moved hooks/components are all gone.

- [ ] **Step 2 — keep helpers `pageBlockToBlockData`, `blockDataToPageBlock`, `ALIGNMENTS` verbatim** (current lines 37–82). No change.

- [ ] **Step 3 — rewrite the component body.** Replace `const AdminPageEditor: Component = () => { ... };` (current 84–562) with:

```tsx
const AdminPageEditor: Component = () => {
    // ─── Page property signals (still owned here) ───
    const [title, setTitle,] = createSignal('',);
    const [titleAlignment, setTitleAlignment,] = createSignal('left',);
    const [slug, setSlug,] = createSignal('',);
    const [showTitle, setShowTitle,] = createSignal(true,);
    const [status, setStatus,] = createSignal('draft',);
    const [accessLevel, setAccessLevel,] = createSignal('public',);
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

        const orderByParent = new Map<string | null, number>();
        const orderById = new Map<string, number>();
        for (const b of currentBlocks) {
            const key = b.parentBlockId ?? null;
            const next = (orderByParent.get(key,) ?? -1) + 1;
            orderByParent.set(key, next,);
            orderById.set(b.id, next,);
        }

        for (const b of currentBlocks) {
            const order = orderById.get(b.id,) ?? 0;
            const payload = blockDataToPageBlock(b, order,);
            if (origIds.has(b.id,)) {
                await cms.pages.updateBlock(pageId, b.id, payload as any,);
            } else {
                await cms.pages.createBlock(pageId, { ...payload, id: b.id, } as any,);
            }
        }

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
            {/* … EXACTLY the current <div class="editor-properties"> … block
                (current PageEditor lines 342–448): Title + align buttons,
                Slug, "Show title on page" toggle, Status, Access, "Use as
                homepage" toggle. Each onInput/onChange calls the same setter
                then `editor.markDirty()` in place of the old `markDirty()`. */}
        </CollapsiblePanel>
    );

    const previewBody = (
        <Layout>
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
                    <div class="preview-empty-message">No content blocks to preview</div>
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
```

> **Fill in the `properties` panel body verbatim** from the current file (lines 342–448) — the Title input + `page-editor__align-buttons` SVG `<For each={ALIGNMENTS}>`, Slug, the show-title `Toggle` + `Tooltip`, Status/Access `<select>`s, and the homepage `Toggle` + help text. Only change: every `markDirty()` call becomes `editor.markDirty()`, and the setters stay (`setTitle`, `setTitleAlignment`, `setSlug`, `setShowTitle`, `setStatus`, `setAccessLevel`, `setIsHomepage`). Add `import { createSignal, } from 'solid-js';` to the import list (needed for the property signals) — merge it into the existing `solid-js` import.

> **Parity check on View URL:** current PageEditor uses `` `/${page()?.slug}` ``. The shell only shows View when `status()==='published'`; `publicUrl` falls back to the live `slug()` signal if the resource slug is momentarily absent — behaviorally identical for a published page.

- [ ] **Step 4 — build:**

```bash
pnpm --filter @sitesurge/admin run build
```
Expected: exit 0. This is the first build that bundles `useEntityEditor` + `EntityEditorShell`, so a green result validates the whole page path (imports resolve, JSX valid, controller wired).

- [ ] **Step 5 — lint (catches leftover unused imports like `A`):**

```bash
pnpm --filter @sitesurge/admin run lint
```
Expected: no new errors in `PageEditor.tsx`. Remove any import lint flags as unused.

- [ ] **Step 6 — smoke test manually (recommended, superpowers:verification-before-completion).** `pnpm --filter @sitesurge/admin run dev`, open `/admin/pages/new`: create a page (title+slug), add a block, Ctrl+S → toast "Page '…' saved", URL becomes `/admin/pages/<id>`. Reload, edit, Save. Toggle full-width (root gets `admin-full-bleed`). Preview (draft) shows site chrome. Delete → trash + redirect; open a deleted page → Restore. Confirm autosave key `rw-draft:page-draft-<id>` appears in localStorage.

- [ ] **Step 7 — commit:**

```bash
git add packages/cms/src/pages/admin/PageEditor.tsx
git commit -m "refactor(admin): PageEditor onto useEntityEditor + EntityEditorShell"
```

---

## Task 3: Migrate `PostEditor` onto the shell

**Files:**
- Modify `packages/cms/src/pages/admin/PostEditor.tsx` (replace the whole `AdminPostEditor` component, 29–581).

### Steps

- [ ] **Step 1 — trim imports.** Drop the shell-owned imports (`AutoSaveIndicator`, `BlockEditor`, `ConfirmModal`, `EditorSaveBar`, `PreviewOverlay`, `RevisionsPanel`, `Title`, `useNavigate`, `useParams`, the four lifecycle hooks, `AutoSaveIndicator`) and keep what the post body + save still use. New import set:

```tsx
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import CollapsiblePanel from '../../components/admin/common/CollapsiblePanel';
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
```

- [ ] **Step 2 — rewrite the component.** Replace 29–581 with:

```tsx
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
    const [showImageSelect, setShowImageSelect,] = createSignal(false,);
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
                contentBlocks: ctx.blocks.map((b, i,) => {
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
        setPublishAt(p.publishAt ? new Date(p.publishAt,).toISOString().slice(0, 16,) : '',);
        const blockList = (p as any).contentBlocks as any[] | undefined;
        if (blockList?.length) {
            const converted = blockList.map((b,) => ({
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
            {/* … EXACTLY the current <div class="editor-properties"> block
                (current PostEditor lines 297–427): Title, Slug, Excerpt,
                Tags, Banner Image field (Select Media / Upload New / Remove),
                Status, conditional Publish At, Access, Author <select> over
                `staffUsers()`. Replace every `markDirty()` with
                `editor.markDirty()`; the setters are unchanged;
                `setShowImageSelect(true)` / `setShowImageUpload(true)` stay. */}
        </CollapsiblePanel>
    );

    const previewBody = (
        <Layout>
            <div class="post-page page-wrapper">
                <article style={{ 'max-width': '800px', margin: '0 auto', padding: '2rem 1rem', }}>
                    <h1 style={{ 'margin-bottom': '0.5rem', }}>{title() || 'Untitled Post'}</h1>
                    <div style={{ color: 'var(--admin-text-muted, #6b7280)', 'margin-bottom': '2rem', 'font-size': '0.9rem', }}>
                        {status() === 'draft' ? 'Draft' : 'Preview'}
                        {excerpt() ? ` — ${excerpt()}` : ''}
                    </div>
                    <Show when={editor.blocks().length}>
                        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '1rem', }}>
                            <For each={editor.blocks()}>
                                {(block,) => {
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
                        <div class="preview-empty-message">No content blocks to preview</div>
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
```

> **Behavior deltas to preserve:** `onSaved: invalidatePostsCache` fires on save success (before the toast, matching the original order); `onDeleted: invalidatePostsCache` fires on delete; the localStorage draft-restore `confirm()` prompt for new posts is kept as a standalone effect; `staffUsers` resource stays here; the block hydration maps `contentBlocks` (not `blocks`) and generates ids for legacy rows via `generateBlockId()`. The `rootClass` returns `''` (not `undefined`) when not full-bleed — the current file passes `undefined`; an empty-string class is inert and visually identical.

- [ ] **Step 3 — fill in the `properties` panel body verbatim** from current PostEditor lines 297–427, swapping `markDirty()` → `editor.markDirty()`.

- [ ] **Step 4 — build:**

```bash
pnpm --filter @sitesurge/admin run build
```
Expected: exit 0.

- [ ] **Step 5 — lint:**

```bash
pnpm --filter @sitesurge/admin run lint
```
Expected: no new errors in `PostEditor.tsx`; remove any unused-import flags.

- [ ] **Step 6 — smoke test.** `/admin/posts/new`: create (title+slug+tags+excerpt+banner via Select Media), add blocks with a block style, Ctrl+S → "Post '…' saved", URL → `/admin/posts/<id>`, and the Posts list reflects the change (cache invalidated). Reload → the localStorage-draft prompt should NOT appear (title present). New empty post with a stale `rw-draft:post-draft-new` → prompt appears. Scheduled status reveals Publish At. Delete → trash + redirect; Restore a deleted post. Preview shows post chrome + block styles.

- [ ] **Step 7 — commit:**

```bash
git add packages/cms/src/pages/admin/PostEditor.tsx
git commit -m "refactor(admin): PostEditor onto useEntityEditor + EntityEditorShell"
```

---

## Reuse potential (out of scope, noted for follow-up)

`CampaignEditor.tsx` and `FormEditor.tsx` already import the same four lifecycle hooks (`useAutoSave`/`useEditorState`/`useUnsavedChanges`/`useKeyboardShortcuts`) and `EditorSaveBar`, so **`useEntityEditor` (the hook) is a plausible future consumer for them** — they share the resource/dirty/save-state/autosave/Ctrl+S skeleton. However they have **no `BlockEditor`, no `RevisionsPanel`, and no `PreviewOverlay`**, so **`<EntityEditorShell>` (the component) does not fit them** without a leaner variant. `ConnectionEditor.tsx` (160 lines) is a different shape (provider-keyed resource, no save bar) and is not a candidate. Recommendation: keep this plan scoped to Page + Post; revisit extracting a block-less `useEntityEditor` overload for Campaign/Form as a separate effort once the Page+Post shell has proven stable.

---

## Risks & rollback

| Risk | Mitigation |
|------|------------|
| Vite build doesn't type-check, so a wrong controller field could slip through as `undefined` at runtime. | Run `pnpm --filter @sitesurge/admin run lint` each task; do the manual smoke test (Task 2/3 Step 6). Optionally run `pnpm --filter @sitesurge/admin exec tsc --noEmit` if the toolchain resolves the config tsconfig. |
| Autosave key regression (draft lost). | Key format `` `${entityKind}-draft-${params.id||'new'}` `` reproduces `page-draft-*`/`post-draft-*` byte-for-byte; verify `rw-draft:page-draft-<id>` / `rw-draft:post-draft-<id>` in localStorage during smoke test. |
| Save ordering change (e.g. toast before cache invalidation, or navigate before markClean). | `handleSave`/`handleDelete`/`handleRestore` in the hook preserve the exact original statement order; the parity notes call out each ordering. |
| Post cache not invalidated on save/delete. | `onSaved`/`onDeleted` both call `invalidatePostsCache()`. |
| `structuredClone` on blocks behaves differently. | Same call sites, same argument (`blocks()`), unchanged. |
| Preview markup drift (missing wrapper class breaks scoped styles). | `previewBody` slots reproduce the exact `dynamic-page page-wrapper` / `post-page page-wrapper` wrappers and inner markup. |
| Full-bleed root class differs (`page-editor admin-full-bleed` vs bare `admin-full-bleed`). | `rootClass` closures reproduce each editor's original class string. |

**Rollback:** each task is a single self-contained commit touching one file (Task 1 touches two new files). Revert the offending commit with `git revert <sha>`; the new hook/shell are inert until a `*Editor` imports them, so reverting a migration commit fully restores the prior editor with no cross-file cleanup.

---

## Self-review checklist (behavior parity)

- [ ] Autosave keys unchanged: `page-draft-<id|new>`, `post-draft-<id|new>`; autosave state objects contain the same keys (+ `blocks`).
- [ ] Ctrl+S saves in both editors (and works while focused in an input — `useKeyboardShortcuts` special-cases Ctrl+S).
- [ ] Save toast copy exact: `Page '<title>' saved` / `Post '<title>' saved`.
- [ ] Save flow order: persist → `setSavedBlocks` → `autoSave.clear` → `markClean` → (post) `invalidatePostsCache` → toast → navigate-on-new (`replace: true`) to `/admin/{pages,posts}/<id>`.
- [ ] Page save runs `syncBlocks` (delete removed → create/update per-parent order → conditional `reorderBlocks`); post save embeds `contentBlocks` with `__styleRef` resolution.
- [ ] Delete: soft-delete to `status:'deleted'`, `markClean`, (post) invalidate cache, redirect to list; error → toast.
- [ ] Restore: `status:'draft'`, sets the module status signal to `draft`, `markClean`; error → toast.
- [ ] Header: AutoSaveIndicator, Restore (when deleted), Preview (when `!deleted && (dirty || draft)`), View (when published) with correct labels/URLs, Save button with `Saving...`.
- [ ] Properties panel markup + pills (page: Homepage/status/access; post: status/access) identical; every input still calls `markDirty` (now `editor.markDirty`).
- [ ] Preview overlay renders the correct wrapper + body per entity; empty-state message shown when no blocks.
- [ ] Post banner-image `MediaSelectModal`/`MediaUploadModal` still work and `markDirty` on select/upload.
- [ ] Post new-draft `confirm()` restore prompt preserved; `staffUsers` author dropdown preserved.
- [ ] Full-width toggle adds the correct root class per editor.
- [ ] `pnpm --filter @sitesurge/admin run build` green after Task 2 and Task 3; `run lint` reports no new errors.
