import type { Media, } from '@sitesurge/types';
import { Component, createSignal, onCleanup, onMount, Show, } from 'solid-js';
import { Portal, } from 'solid-js/web';
import MediaVideo from '../../blocks/media/MediaVideo';
import VideoPlayer from '../../blocks/media/VideoPlayer';
import { cms, } from '../../../services/cmsClient';
import { downloadFile, formatSize, getTypeLabel, } from './mediaUtils';

interface MediaViewerModalProps {
    media: Media & { title?: string; };
    onClose: () => void;
}

/**
 * Full-size lightbox for one media item (image, encoded or plain video, audio,
 * document) with Copy URL / share link / Download. Used by the media library
 * page and by `MediaSelectModal`. Portaled, and handles its own Escape, so it
 * can sit over another modal; closing it leaves that modal in place.
 * Styles: `.media-modal` (pages/admin/styles/_media.scss).
 */
const MediaViewerModal: Component<MediaViewerModalProps> = (props,) => {
    const m = () => props.media;
    const isImage = () => m().mimeType?.startsWith('image/',);
    const isVideo = () => m().mimeType?.startsWith('video/',);
    const isAudio = () => m().mimeType?.startsWith('audio/',);

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape') {
            e.stopImmediatePropagation();
            props.onClose();
        }
    };
    // Capture phase, so an underlying modal's Escape listener never sees it.
    onMount(() => document.addEventListener('keydown', onKeyDown, true,),);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown, true,),);

    /** URL just copied — flips its button to "Copied" briefly. */
    const [copied, setCopied,] = createSignal<string | null>(null,);
    const flash = (key: string, ms: number,) => {
        setCopied(key,);
        setTimeout(() => setCopied((u,) => (u === key ? null : u)), ms,);
    };
    const copyUrl = (url: string,) => {
        void navigator.clipboard.writeText(url,).then(() => flash(url, 1500,),).catch(() => window.prompt('Copy this URL:', url,));
    };

    /** A 7-day link to the plain video file that skips the access check. */
    const copyShareLink = async (id: string,) => {
        try {
            const { url, } = await cms.media.video.share(id, 7,);
            await navigator.clipboard.writeText(url,).catch(() => window.prompt('Copy this share link:', url,));
            flash(`share:${id}`, 2000,);
        } catch (e) {
            window.alert(`Could not create a share link: ${(e as Error).message}`,);
        }
    };

    /** Images and documents open in a new tab; video/audio use their own controls. */
    const onContentClick = () => {
        if (isImage() || (!isVideo() && !isAudio())) window.open(m().url, '_blank',);
    };

    return (
        <Portal>
            <div
                class="media-modal"
                onClick={(e,) => {
                    if (e.target === e.currentTarget) props.onClose();
                }}
            >
                <div class="media-modal__container" role="dialog" aria-modal="true" aria-label={m().title || m().originalName}>
                    <button class="media-modal__close-icon" onClick={() => props.onClose()} title="Close">
                        &times;
                    </button>

                    <div class="media-modal__content" onClick={onContentClick}>
                        <Show when={isImage()}>
                            <img src={m().url} alt={m().alt || m().title || m().originalName} />
                        </Show>
                        <Show when={isVideo()}>
                            <Show when={m().video} fallback={<VideoPlayer src={m().url} controls={true} />}>
                                <MediaVideo mediaId={m().id} showVariantSwitch showQualityMenu />
                            </Show>
                        </Show>
                        <Show when={isAudio()}>
                            <div class="media-modal__audio">
                                <div class="media-modal__audio-icon">&#9835;</div>
                                <audio src={m().url} controls preload="metadata" />
                            </div>
                        </Show>
                        <Show when={!isImage() && !isVideo() && !isAudio()}>
                            <div class="media-modal__file">
                                <div class="media-modal__file-icon">{getTypeLabel(m().mimeType,)}</div>
                                <div class="media-modal__file-name">{m().originalName}</div>
                                <div class="media-modal__file-hint">Click to open in new tab</div>
                            </div>
                        </Show>
                    </div>

                    <div class="media-modal__footer">
                        <button class="ui-button ui-button--secondary" onClick={() => props.onClose()}>Close</button>
                        <div class="media-modal__meta">
                            <span>{m().title || m().originalName}</span>
                            <span class="media-modal__meta-details">
                                {[
                                    getTypeLabel(m().mimeType,),
                                    m().size ? formatSize(m().size,) : '',
                                    m().createdAt ? new Date(m().createdAt,).toLocaleDateString() : '',
                                    m().id ? '' : 'Not in the media library',
                                ].filter(Boolean,).join(' · ',)}
                            </span>
                        </div>
                        <div class="media-modal__actions">
                            <button
                                class="ui-button ui-button--secondary"
                                title={m().video ? 'Direct link: plays the video file for anyone allowed to watch it' : undefined}
                                onClick={() => copyUrl(m().url,)}
                            >
                                {copied() === m().url ? 'Copied' : 'Copy URL'}
                            </button>
                            <Show when={m().video}>
                                <button
                                    class="ui-button ui-button--secondary"
                                    title="A 7-day link that plays the file for anyone, signed in or not"
                                    onClick={() => void copyShareLink(m().id,)}
                                >
                                    {copied() === `share:${m().id}` ? 'Copied (7 days)' : 'Copy share link'}
                                </button>
                            </Show>
                            <button
                                class="ui-button ui-button--primary"
                                onClick={(e,) => {
                                    e.stopPropagation();
                                    downloadFile(m().url, m().originalName,);
                                }}
                            >
                                Download
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </Portal>
    );
};

export default MediaViewerModal;
