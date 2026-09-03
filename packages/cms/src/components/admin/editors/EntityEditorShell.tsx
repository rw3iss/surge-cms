import { Title, } from '@solidjs/meta';
import { createSignal, JSX, onCleanup, onMount, Show, } from 'solid-js';
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

    const [showRevertConfirm, setShowRevertConfirm,] = createSignal(false,);

    /**
     * Throw away local draft edits and reload the saved version.
     *
     * The stored draft has to go BEFORE the reload — the editor restores any
     * draft newer than the server copy on mount, so reloading without clearing
     * would simply restore the same edits again. That loop is why a restored
     * draft previously could not be discarded at all.
     */
    const revertDraft = () => {
        e.autoSave.cancel();   // kill any in-flight debounced write
        e.autoSave.clear();    // drop the stored draft
        e.markClean();         // so the unsaved-changes guard doesn't block us
        setShowRevertConfirm(false,);
        window.location.reload();
    };
    const heading = () => e.isNew() ? props.labels.newHeading : props.labels.editHeading(props.title(),);

    let rootEl: HTMLDivElement | undefined;
    let headerEl: HTMLDivElement | undefined;

    // Pin the inline edit flyout just below the sticky editor header: publish
    // the header's live height as `--editor-sticky-top` so the flyout's sticky
    // `top` meets the header's BOTTOM edge, not the action buttons. Recompute
    // when the header height changes (title wrap, buttons showing/hiding).
    const syncStickyTop = () => {
        if (rootEl && headerEl) {
            rootEl.style.setProperty('--editor-sticky-top', `${headerEl.offsetHeight}px`,);
        }
    };
    onMount(() => {
        syncStickyTop();
        let ro: ResizeObserver | undefined;
        if (typeof ResizeObserver !== 'undefined' && headerEl) {
            ro = new ResizeObserver(() => syncStickyTop(),);
            ro.observe(headerEl,);
        }
        window.addEventListener('resize', syncStickyTop,);
        onCleanup(() => {
            ro?.disconnect();
            window.removeEventListener('resize', syncStickyTop,);
        },);
    },);

    return (
        <div class={`entity-editor ${props.rootClass(e.fullBleed(),)}`} ref={rootEl}>
            <Title>{heading()} - Admin - RW</Title>

            <ConfirmModal
                open={showRevertConfirm()}
                title="Discard draft edits"
                message={
                    'This removes every unsaved change on this page and reloads the version '
                    + 'that is currently saved. It cannot be undone.'
                }
                confirmLabel="Discard edits"
                danger
                onConfirm={revertDraft}
                onCancel={() => setShowRevertConfirm(false,)}
            />

            <div class="admin-header admin-header--sticky" ref={headerEl}>
                <h1>{heading()}</h1>
                <div class="admin-header__actions">
                    <AutoSaveIndicator status={e.autoSave.status()} lastSavedAt={e.autoSave.lastSavedAt()} />
                    <Show when={!e.isNew() && e.entity()}>
                        <Show when={e.isDeleted()}>
                            <button
                                class="ui-button ui-button--secondary ui-button--sm"
                                onClick={() => e.setShowRestoreConfirm(true,)}
                                disabled={e.restoring()}
                            >
                                {e.restoring() ? 'Restoring...' : props.labels.restoreLabel}
                            </button>
                        </Show>
                        <Show when={!e.isDeleted() && (e.isDirty() || props.status() === 'draft')}>
                            <button class="ui-button ui-button--ghost ui-button--sm" onClick={() => e.setShowPreview(true,)}>
                                {props.labels.previewLabel}
                            </button>
                        </Show>
                        {/* Discard local edits. Shown only when there is
                            something to discard — either a restored draft from
                            localStorage or unsaved changes in this session.
                            Without it, a restored draft was impossible to get
                            rid of: reloading just restored it again. */}
                        <Show when={!e.isDeleted() && (e.isDirty() || e.autoSave.hasDraft())}>
                            {/* Native title rather than the Tooltip component:
                                that one renders its own help icon and takes no
                                children, so wrapping a button in it silently
                                drops the button. */}
                            <button
                                class="ui-button ui-button--ghost ui-button--sm"
                                title="Remove all current draft edits and return this page to its current live version."
                                onClick={() => setShowRevertConfirm(true,)}
                            >
                                Revert
                            </button>
                        </Show>
                        <Show when={props.status() === 'published'}>
                            <a href={props.publicUrl()} target="_blank" class="ui-button ui-button--secondary ui-button--sm">
                                {props.labels.viewLabel}
                            </a>
                        </Show>
                    </Show>
                    <button class="ui-button ui-button--primary ui-button--sm" onClick={e.handleSave} disabled={e.saving()}>
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
