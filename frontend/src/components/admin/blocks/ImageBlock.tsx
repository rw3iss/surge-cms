import { Component, createSignal, Show, } from 'solid-js';
import MediaPickerModal, { MediaItem, } from '../MediaPickerModal';

interface ImageBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const ImageBlock: Component<ImageBlockProps> = (props,) => {
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
                    ...props.data,
                    url: media.url,
                    fileName: media.originalName || file.name,
                    fileSize: file.size,
                    mediaId: undefined,
                },);
            }
        } finally {
            setUploading(false,);
        }
    };

    const handleMediaSelect = (media: MediaItem,) => {
        props.onUpdate({
            ...props.data,
            url: media.url,
            fileName: media.originalName,
            fileSize: media.size,
            mediaId: media.id,
        },);
        setShowPicker(false,);
    };

    return (
        <div class="block-image">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-image__preview">
                        <Show
                            when={props.data.url}
                            fallback={
                                <span class="block-text__empty">No image selected. Click Edit to upload one.</span>
                            }
                        >
                            <img
                                src={props.data.url}
                                alt={props.data.alt || ''}
                                style={{
                                    'max-width': props.data.maxWidth ? `${props.data.maxWidth}px` : '100%',
                                    'max-height': props.data.maxHeight ? `${props.data.maxHeight}px` : 'auto',
                                    display: 'block',
                                    margin: props.data.alignment === 'center' ?
                                        '0 auto' :
                                        props.data.alignment === 'right' ?
                                        '0 0 0 auto' :
                                        undefined,
                                }}
                            />
                            <Show when={props.data.alt}>
                                <div class="block-image__alt">{props.data.alt}</div>
                            </Show>
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Image</label>
                    <Show when={props.data.url}>
                        <img
                            src={props.data.url}
                            alt={props.data.alt || ''}
                            style={{ 'max-width': '200px', 'margin-bottom': '0.5rem', 'border-radius': '4px', }}
                        />
                    </Show>
                    <Show when={uploading()}>
                        <div class="block-upload-spinner">Uploading...</div>
                    </Show>
                    <Show when={!uploading()}>
                        <div class="block-media-controls">
                            <input type="file" accept="image/*" onChange={handleFileUpload} />
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
                            {props.data.fileName} ({Math.round((props.data.fileSize || 0) / 1024,)} KB)
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
                    <label>Alt Text</label>
                    <input
                        type="text"
                        value={props.data.alt || ''}
                        onInput={(e,) => props.onUpdate({ ...props.data, alt: e.currentTarget.value, },)}
                        placeholder="Describe the image"
                    />
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Max Width (px)</label>
                        <input
                            type="number"
                            value={props.data.maxWidth || ''}
                            onInput={(e,) =>
                                props.onUpdate({
                                    ...props.data,
                                    maxWidth: parseInt(e.currentTarget.value,) || undefined,
                                },)}
                            placeholder="Auto"
                        />
                    </div>
                    <div class="form-group">
                        <label>Max Height (px)</label>
                        <input
                            type="number"
                            value={props.data.maxHeight || ''}
                            onInput={(e,) =>
                                props.onUpdate({
                                    ...props.data,
                                    maxHeight: parseInt(e.currentTarget.value,) || undefined,
                                },)}
                            placeholder="Auto"
                        />
                    </div>
                    <div class="form-group">
                        <label>Alignment</label>
                        <select
                            value={props.data.alignment || 'left'}
                            onChange={(e,) => props.onUpdate({ ...props.data, alignment: e.currentTarget.value, },)}
                        >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                        </select>
                    </div>
                </div>
                <Show when={showPicker()}>
                    <MediaPickerModal type="image" onSelect={handleMediaSelect} onClose={() => setShowPicker(false,)} />
                </Show>
            </Show>
        </div>
    );
};

export default ImageBlock;
