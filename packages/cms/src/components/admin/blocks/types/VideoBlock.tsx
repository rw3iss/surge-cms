import { openMediaViewer, } from '@/stores/mediaViewer';
import type { Media, } from '@sitesurge/types';
import { Component, createSignal, Match, Show, Switch, type JSX, } from 'solid-js';
import MediaVideo from '../../../blocks/media/MediaVideo';
import VideoPlayer from '../../../blocks/media/VideoPlayer';
import { startUpload, uploads, usesMultipart, whenComplete, } from '@/stores/uploads';
import { resolveVideoSource, } from '@/utils/resolveVideoSource';
import MediaPickerModal, { MediaItem, } from '../../media/MediaPickerModal';
import { cms, } from '@/services/cmsClient';
import Toggle from '../../common/Toggle';
import { FormField, } from '../../forms';

interface VideoBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

/** File name without its extension — the default title for an upload. */
const baseName = (name: string,): string => name.replace(/\.[^.]+$/, '',);

const VideoBlock: Component<VideoBlockProps> = (props,) => {
    const [uploading, setUploading,] = createSignal(false,);
    const [uploadRowId, setUploadRowId,] = createSignal<string | null>(null,);
    const [uploadError, setUploadError,] = createSignal<string | null>(null,);
    const [showPicker, setShowPicker,] = createSignal(false,);

    const uploadPercent = () => {
        const id = uploadRowId();
        return id ? (uploads.items.find((i,) => i.id === id,)?.percent ?? 0) : 0;
    };

    /**
     * Store a library video on the block. `posterUrl` + `title` ride along in
     * settings because the email and SSR renderers read them (they cannot
     * fetch); the poster is refreshed from playback, which knows the encoded one.
     */
    const applyMedia = (m: { id: string; url: string; originalName?: string; size?: number; thumbnailUrl?: string | null; video?: Media['video']; },) => {
        const base = {
            ...props.data,
            url: m.url,
            mediaId: m.id,
            fileName: m.originalName,
            fileSize: m.size,
            posterUrl: m.video?.posterUrl ?? m.thumbnailUrl ?? undefined,
            title: props.data.title || (m.originalName ? baseName(m.originalName,) : undefined),
        };
        props.onUpdate(base,);
        cms.media.playback(m.id,).then((pb,) => {
            if (props.data.mediaId !== m.id) return;
            const posterUrl = pb.posterUrl ?? props.data.posterUrl;
            const title = pb.title || props.data.title;
            if (posterUrl !== props.data.posterUrl || title !== props.data.title) {
                props.onUpdate({ ...props.data, posterUrl, title, },);
            }
        },).catch(() => { /* not an encoded video / feature off — keep what we have */ },);
    };

    const handleFileUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        if (!input.files?.[0]) return;
        const file = input.files[0];
        input.value = '';
        setUploadError(null,);
        setUploading(true,);

        try {
            if (usesMultipart(file,)) {
                // Direct multipart upload (video feature): resumable, tracked in
                // the upload tray, encoded server-side afterwards.
                const rowId = startUpload(file, { title: baseName(file.name,), },);
                setUploadRowId(rowId,);
                const media = await whenComplete(rowId,);
                if (!media) {
                    setUploadError('Upload did not finish — see the upload tray to retry.',);
                    return;
                }
                applyMedia(media,);
                return;
            }
            const media = await cms.media.blockUpload(file,);
            props.onUpdate({
                ...props.data,
                url: media.url,
                fileName: media.originalName || file.name,
                fileSize: file.size,
                mediaId: undefined,
                posterUrl: undefined,
            },);
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed',);
        } finally {
            setUploading(false,);
            setUploadRowId(null,);
        }
    };

    const handleMediaSelect = (media: MediaItem,) => {
        applyMedia(media,);
        setShowPicker(false,);
    };

    /** Preview: a library video plays through MediaVideo; a URL by its kind. */
    const preview = (style?: Record<string, string>,): JSX.Element => {
        const resolved = () => resolveVideoSource({ url: props.data.url || '', },);
        return (
            <Switch>
                <Match when={props.data.mediaId}>
                    <div style={style}>
                        <MediaVideo mediaId={props.data.mediaId} showVariantSwitch fallbackSrc={props.data.url || undefined} />
                    </div>
                </Match>
                <Match when={props.data.url && resolved().kind === 'embed'}>
                    <iframe src={resolved().src} frameborder="0" allowfullscreen class="video-block__iframe" style={style} />
                </Match>
                <Match when={props.data.url}>
                    <VideoPlayer
                        src={resolved().kind === 'file' ? resolved().src : undefined}
                        hlsSrc={resolved().kind === 'hls' ? resolved().src : undefined}
                        type={resolved().type}
                        controls={true}
                        autoplay={props.data.autoplay}
                        loop={props.data.loop}
                        muted={props.data.autoplay}
                        style={style}
                    />
                </Match>
            </Switch>
        );
    };

    return (
        <div class="block-video">
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-video__preview">
                        <Show
                            when={props.data.url || props.data.mediaId}
                            fallback={
                                <span class="block-text__empty">
                                    No video selected. Click Edit to upload or link one.
                                </span>
                            }
                        >
                            {preview({
                                ...(props.data.maxWidth ? { 'max-width': `${props.data.maxWidth}px`, } : {}),
                                ...(props.data.maxHeight ? { 'max-height': `${props.data.maxHeight}px`, } : {}),
                            },)}
                        </Show>
                    </div>
                }
            >
                <div class="form-group">
                    <label>Video</label>
                    <Show when={props.data.url || props.data.mediaId}>
                        {preview({ 'max-width': '320px', 'margin-bottom': '0.5rem', 'border-radius': '4px', },)}
                        <Show when={props.data.mediaId}>
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
                                style={{ 'margin-bottom': '0.5rem', }}
                                onClick={() => openMediaViewer({ id: props.data.mediaId!, },)}
                            >
                                View full size
                            </button>
                        </Show>
                    </Show>
                    <Show when={uploading()}>
                        <div class="block-upload-spinner">
                            Uploading{uploadRowId() ? ` ${Math.round(uploadPercent(),)}%` : '...'}
                        </div>
                    </Show>
                    <Show when={uploadError()}>
                        <span class="form-help form-help--error">{uploadError()}</span>
                    </Show>
                    <Show when={!uploading()}>
                        <div class="block-media-controls">
                            <input type="file" accept="video/*" onChange={handleFileUpload} />
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
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
                <FormField label="URL (or paste a URL instead of uploading)">
                    <input
                        type="url"
                        value={props.data.url || ''}
                        onChange={(e,) => {
                            const url = e.currentTarget.value;
                            if (url === (props.data.url || '')) return;
                            // A typed URL replaces any library video.
                            props.onUpdate({ ...props.data, url, mediaId: undefined, posterUrl: undefined, },);
                        }}
                        placeholder="https://..."
                    />
                </FormField>
                <div class="form-row">
                    <FormField label="Max Width (px)">
                        <input
                            type="number"
                            value={props.data.maxWidth || ''}
                            onChange={(e,) =>
                                props.onUpdate({
                                    ...props.data,
                                    maxWidth: parseInt(e.currentTarget.value,) || undefined,
                                },)}
                            placeholder="Auto"
                        />
                    </FormField>
                    <FormField label="Max Height (px)">
                        <input
                            type="number"
                            value={props.data.maxHeight || ''}
                            onChange={(e,) =>
                                props.onUpdate({
                                    ...props.data,
                                    maxHeight: parseInt(e.currentTarget.value,) || undefined,
                                },)}
                            placeholder="Auto"
                        />
                    </FormField>
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
