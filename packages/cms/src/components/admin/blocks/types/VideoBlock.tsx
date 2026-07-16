import { Component, createSignal, Show, } from 'solid-js';
import VideoPlayer from '../../../blocks/media/VideoPlayer';
import MediaPickerModal, { MediaItem, } from '../../media/MediaPickerModal';
import { cms, } from '@/services/cmsClient';
import Toggle from '../../common/Toggle';

interface VideoBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const VideoBlock: Component<VideoBlockProps> = (props,) => {
    const [uploading, setUploading,] = createSignal(false,);
    const [showPicker, setShowPicker,] = createSignal(false,);

    const handleFileUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        if (!input.files?.[0]) return;
        const file = input.files[0];
        setUploading(true,);

        try {
            const media = await cms.media.blockUpload(file,);
            props.onUpdate({
                ...props.data,
                url: media.url,
                fileName: media.originalName || file.name,
                fileSize: file.size,
                mediaId: undefined,
            },);
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
        <div class="block-video">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-video__preview">
                        <Show
                            when={props.data.url}
                            fallback={
                                <span class="block-text__empty">
                                    No video selected. Click Edit to upload or link one.
                                </span>
                            }
                        >
                            <VideoPlayer
                                src={props.data.url}
                                controls={true}
                                autoplay={props.data.autoplay}
                                loop={props.data.loop}
                                muted={props.data.autoplay}
                                style={{
                                    ...(props.data.maxWidth ? { 'max-width': `${props.data.maxWidth}px`, } : {}),
                                    ...(props.data.maxHeight ? { 'max-height': `${props.data.maxHeight}px`, } : {}),
                                }}
                            />
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Video</label>
                    <Show when={props.data.url}>
                        <VideoPlayer
                            src={props.data.url}
                            controls={true}
                            style={{ 'max-width': '300px', 'margin-bottom': '0.5rem', 'border-radius': '4px', }}
                        />
                    </Show>
                    <Show when={uploading()}>
                        <div class="block-upload-spinner">Uploading...</div>
                    </Show>
                    <Show when={!uploading()}>
                        <div class="block-media-controls">
                            <input type="file" accept="video/*" onChange={handleFileUpload} />
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
                            {props.data.fileName} ({Math.round((props.data.fileSize || 0) / 1024 / 1024 * 10,) / 10} MB)
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
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <Toggle
                            checked={props.data.autoplay || false}
                            onChange={(next,) => props.onUpdate({ ...props.data, autoplay: next, },)}
                            label="Autoplay"
                        />
                    </div>
                    <div class="form-group">
                        <Toggle
                            checked={props.data.loop || false}
                            onChange={(next,) => props.onUpdate({ ...props.data, loop: next, },)}
                            label="Loop"
                        />
                    </div>
                </div>
                <Show when={showPicker()}>
                    <MediaPickerModal type="video" onSelect={handleMediaSelect} onClose={() => setShowPicker(false,)} />
                </Show>
            </Show>
        </div>
    );
};

export default VideoBlock;
