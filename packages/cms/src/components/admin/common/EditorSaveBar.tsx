import { Component, type JSX, Show, } from 'solid-js';

export interface EditorSaveBarProps {
    onSave: () => void | Promise<void>;
    onCancel: () => void;
    onDelete?: () => void;
    saving?: boolean;
    deleting?: boolean;
    canSave?: boolean;
    showDelete?: boolean;
    saveLabel?: string;
    cancelLabel?: string;
    deleteLabel?: string;
    /** Extra buttons rendered between Cancel and Save (e.g. a per-page
     *  "Sync from Printify" action). */
    extraActions?: JSX.Element;
}

/**
 * Standard edit-page controls: Delete · Cancel · Save. Place it INSIDE the
 * sticky page header (`.admin-header__actions`) — every admin edit page keeps
 * its controls at the top, never at the bottom of a long form.
 */
const EditorSaveBar: Component<EditorSaveBarProps> = (props,) => (
    <>
        <Show when={props.showDelete !== false && props.onDelete}>
            <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={props.onDelete} disabled={props.deleting}>
                {props.deleting ? 'Deleting...' : (props.deleteLabel || 'Delete')}
            </button>
        </Show>
        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onCancel}>
            {props.cancelLabel || 'Cancel'}
        </button>
        {props.extraActions}
        <button
            type="button"
            class="ui-button ui-button--primary ui-button--sm"
            onClick={() => props.onSave()}
            disabled={props.saving || props.canSave === false}
        >
            {props.saving ? 'Saving...' : (props.saveLabel || 'Save')}
        </button>
    </>
);

export default EditorSaveBar;
