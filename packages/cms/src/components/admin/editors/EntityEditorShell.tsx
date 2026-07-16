import { Title, } from '@solidjs/meta';
import { JSX, Show, } from 'solid-js';
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
