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
        // Rich Text / HTML blocks flush their edits to the block store on BLUR,
        // not per keystroke (keeps caret focus while typing). If the operator
        // clicks Save (or hits Ctrl+S) while a block is still focused, blur it
        // first and yield a frame so that pending flush lands in `blocks()`
        // before we snapshot it below — otherwise the save captures stale
        // content and the block keeps its UNSAVED CHANGES badge until a second
        // click. One press now saves everything.
        if (typeof document !== 'undefined') {
            const active = document.activeElement as HTMLElement | null;
            if (active && active !== document.body && typeof active.blur === 'function') {
                active.blur();
                await new Promise<void>((resolve,) => {
                    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve(),);
                    else setTimeout(resolve, 0,);
                },);
            }
        }

        const validationError = config.validate();
        if (validationError) { setError(validationError,); return; }

        // A real Save takes over from the background draft autosave. Abort any
        // pending/in-progress draft write (it's a debounced localStorage-only
        // backup, never sent to the server) so it can't fire a competing write
        // or leave a stale draft behind. The server save below persists the
        // CURRENT viewed version and is the single source of truth — the user
        // never has to wait for the draft or click Save twice.
        autoSave.cancel();

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
