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
    /** Extra buttons rendered after Cancel in the left group (e.g. a per-page
     *  "Sync from Printify" action). */
    extraActions?: JSX.Element;
}

/**
 * Standardized save bar for admin edit pages.
 * Renders a Save + Cancel on the left and an optional Delete on the right.
 */
const EditorSaveBar: Component<EditorSaveBarProps> = (props,) => {
    return (
        <div class="editor-save-bar">
            <div class="editor-save-bar__main">
                <button
                    class="ui-button ui-button--primary"
                    onClick={() => props.onSave()}
                    disabled={props.saving || props.canSave === false}
                >
                    {props.saving ? 'Saving...' : (props.saveLabel || 'Save')}
                </button>
                <button class="ui-button ui-button--secondary" onClick={props.onCancel}>
                    {props.cancelLabel || 'Cancel'}
                </button>
                {props.extraActions}
            </div>
            <Show when={props.showDelete !== false && props.onDelete}>
                <button
                    class="ui-button ui-button--danger"
                    onClick={props.onDelete}
                    disabled={props.deleting}
                >
                    {props.deleting ? 'Deleting...' : (props.deleteLabel || 'Delete')}
                </button>
            </Show>
        </div>
    );
};

export default EditorSaveBar;
