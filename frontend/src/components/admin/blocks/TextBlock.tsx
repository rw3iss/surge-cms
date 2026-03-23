import { Component, Show, } from 'solid-js';
import { api, } from '../../../services/api';
import RichTextEditor from '../RichTextEditor';

interface TextBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const handleImageUpload = async (file: File,): Promise<string> => {
    const response = await api.upload<{ url: string; }>('/media', file, 'file',);
    if (response.success && (response as any).data?.url) {
        return (response as any).data.url;
    }
    throw new Error('Upload failed',);
};

const TextBlock: Component<TextBlockProps> = (props,) => {
    return (
        <div class="block-text">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-text__preview">
                        <Show
                            when={props.data.content}
                            fallback={<span class="block-text__empty">No content yet. Click Edit to add text.</span>}
                        >
                            <div innerHTML={props.data.content} />
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <RichTextEditor
                        value={props.data.content || ''}
                        onChange={(html,) => props.onUpdate({ ...props.data, content: html, },)}
                        placeholder="Enter text content..."
                        onImageUpload={handleImageUpload}
                    />
                </div>
            </Show>
        </div>
    );
};

export default TextBlock;
