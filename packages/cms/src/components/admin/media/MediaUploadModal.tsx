import { createSignal, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import './MediaUploadModal.scss';

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

function formatSize(bytes: number,): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1,) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1,) + ' MB';
}

export default function MediaUploadModal(props: MediaUploadModalProps,) {
    const [file, setFile,] = createSignal<File | null>(null,);
    const [previewUrl, setPreviewUrl,] = createSignal('',);
    const [title, setTitle,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [uploading, setUploading,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    let fileInputRef: HTMLInputElement | undefined;

    const isVideo = () => file()?.type.startsWith('video/',);
    const isImage = () => file()?.type.startsWith('image/',);

    const handleFileSelect = (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const selected = input.files?.[0];
        if (!selected) return;
        setFile(selected,);
        setError('',);
        // Create preview URL
        if (previewUrl()) URL.revokeObjectURL(previewUrl(),);
        setPreviewUrl(URL.createObjectURL(selected,),);
    };

    const handleUpload = async () => {
        const f = file();
        if (!f) return;
        setUploading(true,);
        setError('',);

        try {
            const fields: Record<string, string> = {};
            if (title()) fields.title = title();
            if (description()) fields.alt = description();

            const media = await cms.media.upload(f, fields,);
            setSuccess(true,);
            setTimeout(() => {
                props.onUploaded(media as unknown as MediaItem,);
            }, 1000,);
        } catch (err: any) {
            setError(err?.message || 'Upload failed',);
        } finally {
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
                            <button type="button" class="btn btn--primary" onClick={() => fileInputRef?.click()}>
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
                            <div class="form-group">
                                <label>Title (optional)</label>
                                <input
                                    type="text"
                                    value={title()}
                                    onInput={(e,) => setTitle(e.currentTarget.value,)}
                                    placeholder="Media title"
                                />
                            </div>
                            <div class="form-group">
                                <label>Description (optional)</label>
                                <textarea
                                    rows={2}
                                    value={description()}
                                    onInput={(e,) => setDescription(e.currentTarget.value,)}
                                    placeholder="Brief description..."
                                />
                            </div>
                        </div>
                    </Show>
                </div>

                <Show when={error()}>
                    <div class="alert alert--error" style={{ margin: '0 1.5rem', }}>{error()}</div>
                </Show>

                <div class="media-upload-modal__footer">
                    <Show when={uploading()}>
                        <div class="media-upload-modal__status">
                            <span class="spinner" /> Uploading, please wait...
                        </div>
                    </Show>
                    <Show when={success()}>
                        <div class="media-upload-modal__status media-upload-modal__status--success">
                            Media uploaded!
                        </div>
                    </Show>
                    <Show when={!uploading() && !success()}>
                        <button type="button" class="btn btn--secondary" onClick={props.onClose}>Cancel</button>
                        <button type="button" class="btn btn--primary" onClick={handleUpload} disabled={!file()}>
                            Upload
                        </button>
                    </Show>
                </div>
        </ModalShell>
    );
}
