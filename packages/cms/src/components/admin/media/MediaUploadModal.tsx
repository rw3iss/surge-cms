import { isVideoFile, } from '@sitesurge/types';
import type { MediaAccessLevel, UploadSessionOptions, } from '@sitesurge/types';
import { createSignal, onCleanup, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { cancel, defaultTitle, setUploadTitle, startUpload, uploads, usesMultipart, whenComplete, } from '../../../stores/uploads';
import ModalShell from '../common/ModalShell';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import { formatSize, } from './mediaUtils';
import { formatEta, formatSpeed, } from './videoFormat';
import './MediaUploadModal.scss';
import './VideoMedia.scss';

interface MediaItem {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    title?: string;
    createdAt: string;
}

interface MediaUploadModalProps {
    onUploaded: (media: MediaItem,) => void;
    onClose: () => void;
    acceptTypes?: string;
}

export default function MediaUploadModal(props: MediaUploadModalProps,) {
    const [file, setFile,] = createSignal<File | null>(null,);
    const [previewUrl, setPreviewUrl,] = createSignal('',);
    const [title, setTitle,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    /** Screen-reader text — its own field; the description is NOT copied into it. */
    const [alt, setAlt,] = createSignal('',);
    const [uploading, setUploading,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    let fileInputRef: HTMLInputElement | undefined;

    const isVideo = () => { const f = file(); return !!f && isVideoFile(f.name, f.type,); };
    const isImage = () => file()?.type.startsWith('image/',);

    // ── Direct (multipart) upload path: video files and anything > 50 MB,
    //    when the `video` feature is on. Progress lives in the upload tray. ──
    const direct = () => {
        const f = file();
        return !!f && usesMultipart(f,);
    };
    const [access, setAccess,] = createSignal<MediaAccessLevel>('public',);
    const [keepOriginal, setKeepOriginal,] = createSignal(true,);
    const [teaser, setTeaser,] = createSignal(false,);
    const [teaserStart, setTeaserStart,] = createSignal(0,);
    const [teaserLength, setTeaserLength,] = createSignal(30,);
    const [defaultsLoaded, setDefaultsLoaded,] = createSignal(false,);
    /** Local row id in the uploads store once queued. */
    const [queuedId, setQueuedId,] = createSignal<string | null>(null,);
    let closed = false;
    onCleanup(() => { closed = true; },);

    const loadVideoDefaults = async () => {
        if (defaultsLoaded()) return;
        setDefaultsLoaded(true,);
        try {
            const s = await cms.media.video.settings();
            setKeepOriginal(s.keepOriginal,);
            setTeaser(s.teaserEnabled,);
            setTeaserStart(s.teaserStartSeconds,);
            setTeaserLength(s.teaserSeconds,);
        } catch { /* not readable for this role — keep the built-in defaults */ }
    };

    const queued = () => {
        const id = queuedId();
        return id ? uploads.items.find((i,) => i.id === id,) : undefined;
    };

    const seconds = (v: string, fallback: number,) => {
        const n = Number(v,);
        return Number.isFinite(n,) && n >= 0 ? n : fallback;
    };

    /** Commit a title edit (blur / Enter). A running upload gets the new
     *  title on completion. */
    const commitTitle = (v: string,) => {
        setTitle(v,);
        const id = queuedId();
        if (id) setUploadTitle(id, v.trim() || defaultTitle(file()?.name ?? '',),);
    };

    /** Abort handle of a classic (non-multipart) upload in flight. */
    let classicAbort: AbortController | null = null;
    const [cancelling, setCancelling,] = createSignal(false,);
    /** Back to an empty modal after a cancel. */
    const reset = () => {
        if (previewUrl()) URL.revokeObjectURL(previewUrl(),);
        setPreviewUrl('',);
        setFile(null,);
        setTitle('',);
        setQueuedId(null,);
        setUploading(false,);
    };
    /** Cancel the upload — or, once uploaded, stop the video's processing and
     *  delete it (confirmed). */
    const cancelUpload = async () => {
        if (classicAbort) {
            classicAbort.abort();
            return;
        }
        const id = queuedId();
        const q = queued();
        if (!id || !q) return;
        if (q.state === 'done' && !confirm(`Stop processing "${q.name}" and delete it?`,)) return;
        setCancelling(true,);
        try {
            await cancel(id,);
            reset();
        } catch (e) {
            setError((e as Error)?.message || 'Could not cancel.',);
        } finally {
            setCancelling(false,);
        }
    };

    const startDirect = (f: File,) => {
        const options: UploadSessionOptions = {};
        options.title = title().trim() || defaultTitle(f.name,);
        if (description()) options.caption = description();
        if (alt().trim()) options.alt = alt().trim();
        if (isVideo()) {
            options.accessLevel = access();
            options.keepOriginal = keepOriginal();
            options.teaser = teaser();
            if (teaser()) {
                options.teaserStartSeconds = teaserStart();
                options.teaserSeconds = teaserLength();
            }
        }
        const id = startUpload(f, options,);
        setQueuedId(id,);
        void whenComplete(id,).then((media,) => {
            // Hand the media back only while this modal is still open (a picker
            // waiting on it); once closed, the library refetches on its own.
            if (media && !closed) props.onUploaded(media as unknown as MediaItem,);
        },);
    };

    const handleFileSelect = (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const selected = input.files?.[0];
        if (!selected) return;
        setFile(selected,);
        setTitle(defaultTitle(selected.name,),);
        setError('',);
        if (usesMultipart(selected,) && isVideoFile(selected.name, selected.type,)) void loadVideoDefaults();
        // Create preview URL
        if (previewUrl()) URL.revokeObjectURL(previewUrl(),);
        setPreviewUrl(URL.createObjectURL(selected,),);
    };

    const handleUpload = async () => {
        const f = file();
        if (!f) return;
        if (direct()) {
            startDirect(f,);
            return;
        }
        setUploading(true,);
        setError('',);

        classicAbort = new AbortController();
        const sentTitle = title().trim() || defaultTitle(f.name,);
        try {
            const fields: Record<string, string> = { title: sentTitle, };
            if (description()) fields.caption = description();
            if (alt().trim()) fields.alt = alt().trim();

            let media = await cms.media.upload(f, fields, { signal: classicAbort.signal, },);
            if (classicAbort.signal.aborted) {
                await cms.media.discard(media.id,).catch(() => undefined);
                reset();
                return;
            }
            // Renamed while it uploaded: apply the latest title.
            const late = title().trim() || defaultTitle(f.name,);
            if (late !== sentTitle) media = await cms.media.update(media.id, { title: late, },);
            setSuccess(true,);
            setTimeout(() => {
                props.onUploaded(media as unknown as MediaItem,);
            }, 1000,);
        } catch (err: any) {
            if (classicAbort?.signal.aborted) reset();
            else setError(err?.message || 'Upload failed',);
        } finally {
            classicAbort = null;
            setUploading(false,);
        }
    };

    return (
        <ModalShell open={true} onClose={props.onClose} size="md" class="media-upload-modal" ariaLabel="Upload Media">
                <div class="media-upload-modal__header">
                    <h2>Upload Media</h2>
                    <button type="button" class="media-upload-modal__close" onClick={props.onClose}>&times;</button>
                </div>

                <div class="media-upload-modal__body">
                    <Show when={!file()}>
                        <div class="media-upload-modal__dropzone">
                            <p>Select a file to upload</p>
                            <button type="button" class="ui-button ui-button--primary" onClick={() => fileInputRef?.click()}>
                                Select File
                            </button>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={props.acceptTypes || 'image/*,video/*'}
                                onChange={handleFileSelect}
                                style={{ display: 'none', }}
                            />
                        </div>
                    </Show>

                    <Show when={file()}>
                        <div class="media-upload-modal__preview">
                            <Show when={isImage()}>
                                <img src={previewUrl()} alt="Preview" class="media-upload-modal__preview-img" />
                            </Show>
                            <Show when={isVideo()}>
                                <video src={previewUrl()} controls class="media-upload-modal__preview-video" />
                            </Show>
                            <div class="media-upload-modal__file-info">
                                <span class="media-upload-modal__file-name">{file()!.name}</span>
                                <span class="media-upload-modal__file-meta">
                                    {formatSize(file()!.size,)} &middot; {file()!.type}
                                </span>
                            </div>
                        </div>

                        <div class="media-upload-modal__fields">
                            <FormField label="Title" hint="Defaults to the file name. You can change it while the file uploads.">
                                {/* Commits on blur / Enter. */}
                                <input
                                    type="text"
                                    value={title()}
                                    maxLength={255}
                                    onChange={(e,) => commitTitle(e.currentTarget.value,)}
                                    onKeyDown={(e,) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                    placeholder={file() ? defaultTitle(file()!.name,) : 'Media title'}
                                />
                            </FormField>
                            <Show when={isImage() || isVideo()}>
                                <FormField
                                    label="Alt text (optional)"
                                    hint="Describe the image for screen readers; leave empty for decorative images."
                                >
                                    <input
                                        type="text"
                                        value={alt()}
                                        maxLength={1000}
                                        onInput={(e,) => setAlt(e.currentTarget.value,)}
                                        placeholder="e.g. A volunteer handing out food at the shelter"
                                    />
                                </FormField>
                            </Show>
                            <FormField label="Description (optional)">
                                <textarea
                                    rows={2}
                                    value={description()}
                                    onInput={(e,) => setDescription(e.currentTarget.value,)}
                                    placeholder="Brief description..."
                                />
                            </FormField>
                            <Show when={direct() && isVideo()}>
                                <div class="media-upload-video-options">
                                    <FormField label="Access" hint="Private videos play in full only for members; everyone else sees the teaser.">
                                        <select
                                            value={access()}
                                            onChange={(e,) => setAccess(e.currentTarget.value as MediaAccessLevel,)}
                                            disabled={!!queuedId()}
                                        >
                                            <option value="public">Public</option>
                                            <option value="private">Private (members)</option>
                                        </select>
                                    </FormField>
                                    <Toggle
                                        checked={keepOriginal()}
                                        onChange={setKeepOriginal}
                                        disabled={!!queuedId()}
                                        label="Keep original file"
                                        hint="Needed to re-encode later. Uses storage."
                                    />
                                    <Toggle
                                        checked={teaser()}
                                        onChange={setTeaser}
                                        disabled={!!queuedId()}
                                        label="Generate teaser"
                                        hint="A short public preview clip."
                                    />
                                    <Show when={teaser()}>
                                        <div class="media-upload-video-options__row">
                                            <FormField label="Teaser start (seconds)">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={teaserStart()}
                                                    disabled={!!queuedId()}
                                                    onChange={(e,) => setTeaserStart(seconds(e.currentTarget.value, teaserStart(),),)}
                                                />
                                            </FormField>
                                            <FormField label="Teaser length (seconds)">
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={teaserLength()}
                                                    disabled={!!queuedId()}
                                                    onChange={(e,) => setTeaserLength(seconds(e.currentTarget.value, teaserLength(),) || teaserLength(),)}
                                                />
                                            </FormField>
                                        </div>
                                    </Show>
                                </div>
                            </Show>
                            <Show when={direct() && !isVideo()}>
                                <p class="form-help-muted">Large file — it uploads straight to storage; progress shows in the upload tray.</p>
                            </Show>
                        </div>
                    </Show>
                </div>

                <Show when={error()}>
                    <div class="alert alert--error" style={{ margin: '0 1.5rem', }}>{error()}</div>
                </Show>

                <div class="media-upload-modal__footer">
                    <Show when={queued()}>
                        {(q,) => (
                            <>
                                <div class="media-upload-modal__status">
                                    {q().state === 'done'
                                        ? 'Uploaded — processing has started.'
                                        : q().state === 'error'
                                        ? `Upload problem: ${q().error ?? 'failed'} (see the upload tray)`
                                        : `${Math.floor(q().percent,)}% ${formatSpeed(q().speed,)}${q().eta !== null ? ` · ${formatEta(q().eta,)} left` : ''} — you can close this window; the upload continues.`}
                                </div>
                                <Show when={q().state !== 'done' || q().processing}>
                                    <button
                                        type="button"
                                        class="ui-button ui-button--danger"
                                        disabled={cancelling()}
                                        title={q().state === 'done' ? 'Stop processing and delete the video' : 'Cancel the upload'}
                                        onClick={() => void cancelUpload()}
                                    >
                                        Cancel upload
                                    </button>
                                </Show>
                                <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose}>Close</button>
                            </>
                        )}
                    </Show>
                    <Show when={uploading()}>
                        <div class="media-upload-modal__status">
                            <span class="spinner" /> Uploading, please wait...
                        </div>
                        <button type="button" class="ui-button ui-button--danger" onClick={() => void cancelUpload()}>Cancel upload</button>
                    </Show>
                    <Show when={success()}>
                        <div class="media-upload-modal__status media-upload-modal__status--success">
                            Media uploaded!
                        </div>
                    </Show>
                    <Show when={!uploading() && !success() && !queuedId()}>
                        <button type="button" class="ui-button ui-button--secondary" onClick={props.onClose}>Cancel</button>
                        <button type="button" class="ui-button ui-button--primary" onClick={handleUpload} disabled={!file()}>
                            Upload
                        </button>
                    </Show>
                </div>
        </ModalShell>
    );
}
