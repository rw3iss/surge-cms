import type { MediaUsage, MediaVideoSummary, } from '@sitesurge/types';
import { createSignal, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import MediaVideo from '../../blocks/media/MediaVideo';
import ModalShell from '../common/ModalShell';
import { FormField, } from '../forms';
import { confirmMediaDelete, fetchMediaUsage, isMediaInUseError, } from '../../../stores/mediaDeleteConfirm';
import MediaUsageList from './MediaUsageList';
import { formatSize, getTypeLabel, } from './mediaUtils';
import VideoStatusPanel from './VideoStatusPanel';
import './MediaEditModal.scss';
import './VideoMedia.scss';

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
    alt?: string | null;
    credits?: string | null;
    width?: number;
    height?: number;
    createdAt: string;
    /** Present on encoded videos (`video` feature). */
    video?: MediaVideoSummary | null;
}

interface MediaEditModalProps {
    media: MediaEditItem;
    onClose: () => void;
    onSaved: (updated: MediaEditItem,) => void;
    onDeleted: (id: string,) => void;
}

export default function MediaEditModal(props: MediaEditModalProps,) {
    const [title, setTitle,] = createSignal(props.media.title || '',);
    const [description, setDescription,] = createSignal(props.media.caption || '',);
    const [credits, setCredits,] = createSignal(props.media.credits || '',);
    const [alt, setAlt,] = createSignal(props.media.alt || '',);
    const [saving, setSaving,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [copied, setCopied,] = createSignal<false | 'url' | 'watch'>(false,);
    /**
     * The values the fields were filled from. Save sends only what differs, so
     * an untouched field can never overwrite a newer value — the grid's list is
     * a cached copy, and filling the form from a stale one then saving all
     * three fields used to write old blanks back (credits vanished).
     */
    const [orig, setOrig,] = createSignal({
        title: props.media.title || '',
        caption: props.media.caption || '',
        credits: props.media.credits || '',
        alt: props.media.alt || '',
    },);

    /** Encoded-video summary — from the grid row, refreshed from the server. */
    const [videoSummary, setVideoSummary,] = createSignal<MediaVideoSummary | null>(props.media.video ?? null,);

    /** Where this media is used (null while loading). */
    const [usages, setUsages,] = createSignal<MediaUsage[] | null>(null,);
    onMount(() => {
        void fetchMediaUsage([props.media.id,],).then(setUsages,);
    },);

    // Start from the server's current record, not the grid's cached row.
    onMount(async () => {
        try {
            const fresh = await cms.media.getById(props.media.id, { cache: false, },) as any;
            if (!fresh) return;
            if (fresh.video !== undefined) setVideoSummary(fresh.video ?? null,);
            const next = { title: fresh.title || '', caption: fresh.caption || '', credits: fresh.credits || '', alt: fresh.alt || '', };
            // Only replace fields the user hasn't started editing.
            if (title() === orig().title) setTitle(next.title,);
            if (description() === orig().caption) setDescription(next.caption,);
            if (credits() === orig().credits) setCredits(next.credits,);
            if (alt() === orig().alt) setAlt(next.alt,);
            setOrig(next,);
        } catch { /* keep the grid's values */ }
    },);

    const busy = () => saving() || deleting();

    const isImage = () => props.media.mimeType?.startsWith('image/',);
    const isVideo = () => props.media.mimeType?.startsWith('video/',);
    /** An encoded video (HLS) — gets the HLS player + the encode status panel. */
    const isEncoded = () => isVideo() && isFeatureEnabled('video',) && !!videoSummary();

    const handleClose = () => {
        if (busy()) return;
        props.onClose();
    };

    const handleSave = async () => {
        setSaving(true,);
        setError('',);
        try {
            const patch: Record<string, string> = {};
            if (title() !== orig().title) patch.title = title();
            if (description() !== orig().caption) patch.caption = description();
            if (credits() !== orig().credits) patch.credits = credits();
            if (alt() !== orig().alt) patch.alt = alt();
            if (Object.keys(patch,).length === 0) {
                props.onClose();
                return;
            }
            const updated = await cms.media.update(props.media.id, patch as any,);
            props.onSaved({ ...props.media, ...(updated as any || {}) } as MediaEditItem,);
        } catch (err: any) {
            setError(err?.message || 'Save failed',);
        } finally {
            setSaving(false,);
        }
    };

    const handleDelete = async () => {
        const ok = await confirmMediaDelete({ ids: [props.media.id,], },);
        if (!ok.confirmed) return;
        setDeleting(true,);
        setError('',);
        try {
            await cms.media.remove(props.media.id, { force: ok.force, },);
            props.onDeleted(props.media.id,);
        } catch (err: any) {
            if (isMediaInUseError(err,)) void fetchMediaUsage([props.media.id,],).then(setUsages,);
            setError(isMediaInUseError(err,) ? 'This file was just put to use somewhere — it was not deleted.' : (err?.message || 'Delete failed'),);
            setDeleting(false,);
        }
    };

    /** Which copy button last succeeded ('url' | 'watch'), for its "Copied" label. */
    const copy = (text: string, which: 'url' | 'watch',) => {
        void navigator.clipboard
            .writeText(text,)
            .then(() => {
                setCopied(which,);
                setTimeout(() => setCopied(false,), 1500,);
            },)
            .catch(() => setError('Copy failed — select and copy the URL manually',),);
    };
    const handleCopyUrl = () => copy(props.media.url, 'url',);
    /** The public player page for a video (teaser + subscribe for non-members). */
    const watchUrl = () => `${window.location.origin}/watch/${props.media.id}`;

    return (
        <ModalShell
            open={true}
            onClose={handleClose}
            size={isEncoded() ? 'lg' : 'md'}
            class={`media-edit-modal${isEncoded() ? ' media-edit-modal--video' : ''}`}
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
                        <Show
                            when={isEncoded()}
                            fallback={<video src={props.media.url} controls class="media-edit-modal__preview-video" />}
                        >
                            <MediaVideo mediaId={props.media.id} showVariantSwitch showQualityMenu class="media-edit-modal__preview-video" />
                        </Show>
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
                        {copied() === 'url' ? 'Copied' : 'Copy'}
                    </button>
                    <Show when={isEncoded()}>
                        <button
                            type="button"
                            class="ui-button ui-button--secondary ui-button--sm"
                            title={watchUrl()}
                            onClick={() => copy(watchUrl(), 'watch',)}
                        >
                            {copied() === 'watch' ? 'Copied' : 'Copy watch link'}
                        </button>
                    </Show>
                </div>

                <Show when={isEncoded()}>
                    <VideoStatusPanel mediaId={props.media.id} />
                </Show>

                <div class="media-edit-modal__usage">
                    <Show when={usages()} fallback={<p class="form-help-muted">Checking where this file is used…</p>}>
                        {(list,) => (
                            <Show when={list().length} fallback={<p class="form-help-muted">Not used in any content.</p>}>
                                <MediaUsageList usages={list()} max={6} />
                            </Show>
                        )}
                    </Show>
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
                    <Show when={isImage() || isVideo()}>
                        <FormField
                            label="Alt text"
                            hint="Describe the image for screen readers; leave empty for decorative images."
                        >
                            <input
                                type="text"
                                value={alt()}
                                onInput={(e,) => setAlt(e.currentTarget.value,)}
                                placeholder="e.g. A volunteer handing out food at the shelter"
                                maxLength={1000}
                                disabled={busy()}
                            />
                        </FormField>
                    </Show>
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
