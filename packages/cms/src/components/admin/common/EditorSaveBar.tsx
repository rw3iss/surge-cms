import { Component, Show, } from 'solid-js';

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
                    class="btn btn--primary"
                    onClick={() => props.onSave()}
                    disabled={props.saving || props.canSave === false}
                >
                    {props.saving ? 'Saving...' : (props.saveLabel || 'Save')}
                </button>
                <button class="btn btn--secondary" onClick={props.onCancel}>
                    {props.cancelLabel || 'Cancel'}
                </button>
            </div>
            <Show when={props.showDelete !== false && props.onDelete}>
                <button
                    class="btn btn--danger"
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
