import { Component, Show, } from 'solid-js';

interface TextBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

/**
 * Rich text body is edited inline on the block preview itself
 * (ContentBlock renders the RichTextEditor when the block is selected).
 * The flyout panel therefore shows only a placeholder hint for these
 * blocks; general settings (block style, padding, etc.) still appear
 * above this body slot in BlockEditController.
 */
const TextBlock: Component<TextBlockProps> = (props,) => {
    return (
        <div class="block-text">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-text__preview">
                        <Show
                            when={props.data.content}
                            fallback={<span class="block-text__empty">No content yet. Click the block to start typing.</span>}
                        >
                            <div innerHTML={props.data.content} />
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <small class="form-help-muted">
                        Click the block to edit text directly with the in-place toolbar.
                    </small>
                </div>
            </Show>
        </div>
    );
};

export default TextBlock;
