import { createSignal, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import './MediaEditModal.scss';

export interface MediaEditItem {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    title?: string;
    caption?: string;
    credits?: string | null;
    width?: number;
    height?: number;
    createdAt: string;
}

interface MediaEditModalProps {
    media: MediaEditItem;
    onClose: () => void;
    onSaved: (updated: MediaEditItem,) => void;
    onDeleted: (id: string,) => void;
}

function formatSize(bytes: number,): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1,)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1,)} MB`;
}

function getTypeLabel(mimeType: string,): string {
    if (mimeType?.startsWith('image/',)) return 'Image';
    if (mimeType?.startsWith('video/',)) return 'Video';
    if (mimeType?.startsWith('audio/',)) return 'Audio';
    return 'Document';
}

export default function MediaEditModal(props: MediaEditModalProps,) {
    const [title, setTitle,] = createSignal(props.media.title || '',);
    const [description, setDescription,] = createSignal(props.media.caption || '',);
    const [credits, setCredits,] = createSignal(props.media.credits || '',);
    const [saving, setSaving,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [copied, setCopied,] = createSignal(false,);

    const busy = () => saving() || deleting();

    const isImage = () => props.media.mimeType?.startsWith('image/',);
    const isVideo = () => props.media.mimeType?.startsWith('video/',);

    const handleClose = () => {
        if (busy()) return;
        props.onClose();
    };

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        try {
            const updated = await cms.media.update(props.media.id, {
                title: title(),
                caption: description(),
                credits: credits(),
            } as any,);
            props.onSaved({ ...props.media, ...(updated as any || {}) } as MediaEditItem,);
        } catch (err: any) {
            setError(err?.message || 'Save failed',);
        } finally {
            setSaving(false,);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Delete this file permanently?',)) return;
        setDeleting(true,);
        setError('',);
        try {
            await cms.media.remove(props.media.id,);
            props.onDeleted(props.media.id,);
        } catch (err: any) {
            setError(err?.message || 'Delete failed',);
            setDeleting(false,);
        }
    };

    const handleCopyUrl = () => {
        void navigator.clipboard
            .writeText(props.media.url,)
            .then(() => {
                setCopied(true,);
                setTimeout(() => setCopied(false,), 1500,);
            },)
            .catch(() => setError('Copy failed — select and copy the URL manually',),);
    };

    return (
        <ModalShell
            open={true}
            onClose={handleClose}
            size="md"
            class="media-edit-modal"
            ariaLabel="Edit Media"
            dismissOnBackdrop={!busy()}
            dismissOnEscape={!busy()}
        >
            <div class="media-edit-modal__header">
                <h2>Edit Media</h2>
                <button type="button" class="media-edit-modal__close" onClick={handleClose} disabled={busy()}>
                    &times;
                </button>
            </div>

            <div class="media-edit-modal__body">
                <div class="media-edit-modal__preview">
                    <Show when={isImage()}>
                        <img
                            src={props.media.url}
                            alt={props.media.title || props.media.originalName}
                            class="media-edit-modal__preview-img"
                        />
                    </Show>
                    <Show when={isVideo()}>
                        <video src={props.media.url} controls class="media-edit-modal__preview-video" />
                    </Show>
                    <Show when={!isImage() && !isVideo()}>
                        <div class="media-edit-modal__preview-file">
                            <div class="media-edit-modal__preview-file-icon">{getTypeLabel(props.media.mimeType,)}</div>
                            <div class="media-edit-modal__preview-file-name">{props.media.originalName}</div>
                        </div>
                    </Show>
                </div>

                <div class="media-edit-modal__info">
                    <span>{props.media.originalName}</span>
                    <span>{getTypeLabel(props.media.mimeType,)}</span>
                    <span>{formatSize(props.media.size,)}</span>
                    <Show when={props.media.width && props.media.height}>
                        <span>{props.media.width}&times;{props.media.height}</span>
                    </Show>
                    <span>{new Date(props.media.createdAt,).toLocaleDateString()}</span>
                </div>

                <div class="media-edit-modal__url">
                    <code>{props.media.url}</code>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={handleCopyUrl}>
                        {copied() ? 'Copied' : 'Copy'}
                    </button>
                </div>

                <div class="media-edit-modal__fields">
                    <FormField label="Title">
                        <input
                            type="text"
                            value={title()}
                            onInput={(e,) => setTitle(e.currentTarget.value,)}
                            placeholder="Media title"
                            disabled={busy()}
                        />
                    </FormField>
                    <FormField label="Description">
                        <textarea
                            rows={3}
                            value={description()}
                            onInput={(e,) => setDescription(e.currentTarget.value,)}
                            placeholder="Brief description..."
                            disabled={busy()}
                        />
                    </FormField>
                    <FormField label="Credits" hint="Photographer, source, or licence line">
                        <input
                            type="text"
                            value={credits()}
                            onInput={(e,) => setCredits(e.currentTarget.value,)}
                            placeholder="e.g. Photo by Jane Doe"
                            disabled={busy()}
                        />
                    </FormField>
                </div>

                <Show when={error()}>
                    <div class="alert alert--error">{error()}</div>
                </Show>
            </div>

            <div class="media-edit-modal__footer">
                <button
                    type="button"
                    class="ui-button ui-button--danger"
                    onClick={handleDelete}
                    disabled={busy()}
                >
                    {deleting() ? 'Deleting...' : 'Delete'}
                </button>
                <div class="media-edit-modal__footer-right">
                    <button type="button" class="ui-button ui-button--secondary" onClick={handleClose} disabled={busy()}>
                        Cancel
                    </button>
                    <button type="button" class="ui-button ui-button--primary" onClick={handleSave} disabled={busy()}>
                        {saving() ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
