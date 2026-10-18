import { openMediaViewer, } from '@/stores/mediaViewer';
import { cssLength, itemRadiusCss, type Media, } from '@sitesurge/types';
import { Component, createSignal, Match, Show, Switch, type JSX, } from 'solid-js';
import MediaVideo from '../../../blocks/media/MediaVideo';
import VideoPlayer from '../../../blocks/media/VideoPlayer';
import { startUpload, uploads, usesMultipart, whenComplete, } from '@/stores/uploads';
import { useVideoTitle, } from '@/hooks/useVideoTitle';
import { resolveVideoSource, } from '@/utils/resolveVideoSource';
import MediaPickerModal, { MediaItem, } from '../../media/MediaPickerModal';
import { cms, } from '@/services/cmsClient';
import Toggle from '../../common/Toggle';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';

/** A size field's value is any CSS length; refuse what could escape a declaration. */
const lengthError = (v: string,): string | null =>
    !v || (cssLength(v,) && !/[;{}<>]/.test(v,)) ? null : 'Use a CSS length, e.g. 480, 480px, 60vh or 40rem.';

interface VideoBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

/** File name without its extension — the default title for an upload. */
const baseName = (name: string,): string => name.replace(/\.[^.]+$/, '',);

const VideoBlock: Component<VideoBlockProps> = (props,) => {
    // Same title the public block + the email show (media title, else the block's own).
    const shownTitle = useVideoTitle({
        enabled: () => props.data.showTitle === true,
        mediaId: () => props.data.mediaId || undefined,
        title: () => props.data.title,
    },);
    const [uploading, setUploading,] = createSignal(false,);
    const [uploadRowId, setUploadRowId,] = createSignal<string | null>(null,);
    const [uploadError, setUploadError,] = createSignal<string | null>(null,);
    const [showPicker, setShowPicker,] = createSignal(false,);
    let fileInput: HTMLInputElement | undefined;

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
                        <MediaVideo mediaId={props.data.mediaId} showVariantSwitch showDownload={props.data.showDownload === true} fallbackSrc={props.data.url || undefined} />
                    </div>
                </Match>
                <Match when={props.data.url && resolved().kind === 'embed'}>
                    <iframe
                        src={resolved().src}
                        frameborder="0"
                        allowfullscreen
                        class="video-block__iframe"
                        style={{ 'border-radius': 'var(--item-radius, var(--site-radius, 6px))', ...style, }}
                    />
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
        <div
            class="block-video"
            // Item border radius → `--item-radius` (read by the player / embed); empty = the site radius.
            style={itemRadiusCss(props.data.itemRadius,) ? { '--item-radius': itemRadiusCss(props.data.itemRadius,)!, } : undefined}
        >
            <Show
                when={props.mode === 'edit'}
                fallback={
                    <div class="block-video__preview">
                        <Show when={shownTitle()}>
                            <h3 class="block-video__title">{shownTitle()}</h3>
                        </Show>
                        <Show
                            when={props.data.url || props.data.mediaId}
                            fallback={
                                <span class="block-text__empty">
                                    No video selected. Click Edit to upload or link one.
                                </span>
                            }
                        >
                            {preview({
                                // Same caps as the public VideoBlock: bare number = px,
                                // and the max height reaches MediaVideo via the variable.
                                ...(cssLength(props.data.maxWidth,) ? { 'max-width': cssLength(props.data.maxWidth,)!, } : {}),
                                ...(cssLength(props.data.maxHeight,) ?
                                    {
                                        'max-height': cssLength(props.data.maxHeight,)!,
                                        '--block-max-height': cssLength(props.data.maxHeight,)!,
                                    } :
                                    {}),
                            },)}
                        </Show>
                    </div>
                }
            >
                <FormField label="Video">
                    <div class="block-video">
                    <Show when={props.data.url || props.data.mediaId}>
                        <div class="block-video__preview">{preview({ 'max-width': '320px', },)}</div>
                        <Show when={props.data.mediaId}>
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary block-video__view"
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
                            {/* A styled button over a hidden file input (as in the
                                Image block) — not the browser's "Choose file". */}
                            <input
                                ref={fileInput}
                                type="file"
                                accept="video/*"
                                class="block-video__file"
                                tabIndex={-1}
                                aria-hidden="true"
                                onChange={handleFileUpload}
                            />
                            <button
                                type="button"
                                class="ui-button ui-button--sm ui-button--secondary"
                                onClick={() => fileInput?.click()}
                            >
                                Upload video
                            </button>
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
                            {props.data.fileName}
                            {/* The size only when it is known — "(0 MB)" read as an empty file. */}
                            <Show when={Number(props.data.fileSize,) > 0}>
                                {` (${Math.round(Number(props.data.fileSize,) / 1024 / 1024 * 10,) / 10} MB)`}
                            </Show>
                        </span>
                    </Show>
                    </div>
                </FormField>
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
                    <FormField label="Max Width" tooltip="Any CSS length (a bare number = px). Empty = no cap.">
                        <CommitInput
                            value={props.data.maxWidth}
                            placeholder="Auto"
                            validate={lengthError}
                            onCommit={(v,) => props.onUpdate({ ...props.data, maxWidth: v || undefined, },)}
                        />
                    </FormField>
                    <FormField label="Max Height" tooltip="Any CSS length (a bare number = px). Empty = no cap.">
                        <CommitInput
                            value={props.data.maxHeight}
                            placeholder="Auto"
                            validate={lengthError}
                            onCommit={(v,) => props.onUpdate({ ...props.data, maxHeight: v || undefined, },)}
                        />
                    </FormField>
                    <FormField
                        label="Item border radius"
                        tooltip="Corners of the video, on the site and in email. Any CSS length (a bare number = px). Empty = the site's Border Radius (Settings → Appearance); 0 = square."
                    >
                        <input
                            type="text"
                            value={props.data.itemRadius ?? ''}
                            placeholder="site default"
                            // Commits on change (blur / Enter), never per keystroke.
                            onChange={(e,) => {
                                const itemRadius = e.currentTarget.value.trim() || undefined;
                                if (itemRadius !== (props.data.itemRadius || undefined)) props.onUpdate({ ...props.data, itemRadius, },);
                            }}
                        />
                    </FormField>
                </div>
                <div class="form-group">
                    <Toggle
                        checked={props.data.showTitle === true}
                        onChange={(next,) => props.onUpdate({ ...props.data, showTitle: next || undefined, },)}
                        label="Show title"
                        hint="Centred above the video — on the site and in email."
                    />
                </div>
                <div class="form-group">
                    <Toggle
                        checked={props.data.showDownload === true}
                        onChange={(next,) => props.onUpdate({ ...props.data, showDownload: next || undefined, },)}
                        label="Show download"
                        hint="Show a Download menu under the video."
                    />
                </div>
                {/* A library video shows its media-library title; a linked video has
                    none, so it takes one here. */}
                <Show when={props.data.showTitle === true && !props.data.mediaId}>
                    <FormField label="Title" hint="Shown centred above the video.">
                        <input
                            type="text"
                            value={props.data.title || ''}
                            onChange={(e,) => {
                                const title = e.currentTarget.value.trim() || undefined;
                                if (title !== (props.data.title || undefined)) props.onUpdate({ ...props.data, title, },);
                            }}
                            placeholder="Video title"
                        />
                    </FormField>
                </Show>
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
