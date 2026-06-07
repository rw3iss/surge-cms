import { Component, createSignal, Show, } from 'solid-js';
import MediaPickerModal, { MediaItem, } from '../../media/MediaPickerModal';

interface DocumentBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const DocumentBlock: Component<DocumentBlockProps> = (props,) => {
    const [uploading, setUploading,] = createSignal(false,);
    const [showPicker, setShowPicker,] = createSignal(false,);

    const handleFileUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        if (!input.files?.[0]) return;
        const file = input.files[0];
        setUploading(true,);

        try {
            const formData = new FormData();
            formData.append('file', file,);

            const response = await fetch('/api/v1/media/block-upload', {
                method: 'POST',
                body: formData,
                credentials: 'include',
            },);
            const result = await response.json();

            if (result.success) {
                const media = result.data;
                props.onUpdate({
                    url: media.url,
                    fileName: media.originalName || file.name,
                    fileSize: file.size,
                    mimeType: file.type,
                    mediaId: undefined,
                },);
            }
        } finally {
            setUploading(false,);
        }
    };

    const handleMediaSelect = (media: MediaItem,) => {
        props.onUpdate({
            url: media.url,
            fileName: media.originalName,
            fileSize: media.size,
            mimeType: media.mimeType,
            mediaId: media.id,
        },);
        setShowPicker(false,);
    };

    const formatFileSize = (bytes: number,) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024,)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1,)} MB`;
    };

    return (
        <div class="block-document">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-document__preview">
                        <Show
                            when={props.data.url}
                            fallback={
                                <span class="block-text__empty">No document attached. Click Edit to upload one.</span>
                            }
                        >
                            <div class="block-document__file">
                                <span class="block-document__icon">&#128196;</span>
                                <div class="block-document__details">
                                    <a href={props.data.url} target="_blank" rel="noopener">
                                        {props.data.fileName || 'Document'}
                                    </a>
                                    <Show when={props.data.fileSize}>
                                        <span class="form-help">
                                            {formatFileSize(props.data.fileSize,)} &middot; {props.data.mimeType}
                                        </span>
                                    </Show>
                                </div>
                            </div>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Document File</label>
                    <Show when={uploading()}>
                        <div class="block-upload-spinner">Uploading...</div>
                    </Show>
                    <Show when={!uploading()}>
                        <div class="block-media-controls">
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                                onChange={handleFileUpload}
                            />
                            <button
                                type="button"
                                class="btn btn--small btn--secondary"
                                onClick={() => setShowPicker(true,)}
                            >
                                Select Existing
                            </button>
                        </div>
                    </Show>
                    <Show when={props.data.fileName}>
                        <span class="form-help">
                            Current: {props.data.fileName} ({formatFileSize(props.data.fileSize || 0,)})
                        </span>
                    </Show>
                </div>
                <div class="form-group">
                    <label>URL (or paste a URL instead of uploading)</label>
                    <input
                        type="url"
                        value={props.data.url || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, url: e.currentTarget.value, },)}
                        placeholder="https://..."
                    />
                </div>
                <div class="form-group">
                    <label>File Name (display)</label>
                    <input
                        type="text"
                        value={props.data.fileName || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, fileName: e.currentTarget.value, },)}
                        placeholder="document.pdf"
                    />
                </div>
                <Show when={showPicker()}>
                    <MediaPickerModal
                        type="document"
                        onSelect={handleMediaSelect}
                        onClose={() => setShowPicker(false,)}
                    />
                </Show>
            </Show>
        </div>
    );
};

export default DocumentBlock;
