/**
 * ImageLinkPicker — the shared image source picker for `image` / `image_link`
 * layout items in BOTH the Site Header and Site Footer editors (DRY: one form,
 * one behavior, one preview).
 *
 * An image item's source resolves as:
 *   imageUrl (external URL override, wins when non-empty)  ||  mediaUrl (library)
 *
 * So the operator can either pick a library image (Select Media / Upload New) or
 * type an external URL — and if both are set the URL takes precedence; clearing
 * the URL falls back to the selected media image. The component owns its own
 * media-modal state so a host just renders it and reacts to `onChange`.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { resolveImageSrc, } from '../../../utils/imageSrc';
import MediaSelectModal, { type MediaItem, } from './MediaSelectModal';
import MediaUploadModal from './MediaUploadModal';
import './ImageLinkPicker.scss';

export interface ImageLinkValue {
    /** External URL override — wins over `mediaUrl` when non-empty. */
    imageUrl?: string;
    /** Selected media-library asset URL. */
    mediaUrl?: string;
    /** Selected media-library asset id. */
    mediaId?: string;
}

// Individual props (not a `value` object) so Solid tracks each field
// reactively — an object-literal prop is re-created per render but its inner
// reads weren't reliably re-tracked, so a media selection didn't re-render.
interface ImageLinkPickerProps {
    imageUrl?: string;
    mediaUrl?: string;
    mediaId?: string;
    onChange: (patch: Partial<ImageLinkValue>,) => void;
}

const ImageLinkPicker: Component<ImageLinkPickerProps> = (props,) => {
    const [showSelect, setShowSelect,] = createSignal(false,);
    const [showUpload, setShowUpload,] = createSignal(false,);

    const src = () => resolveImageSrc(props.imageUrl, props.mediaUrl,);
    const hasMedia = () => Boolean(props.mediaId || props.mediaUrl);
    const urlOverrides = () => Boolean((props.imageUrl ?? '').trim()) && hasMedia();

    const pickMedia = (m: MediaItem,) => {
        // Set the library selection; leave any external URL intact (it still wins,
        // per the precedence rule — the operator clears the URL to use this image).
        props.onChange({ mediaId: m.id, mediaUrl: m.url, },);
        setShowSelect(false,);
        setShowUpload(false,);
    };

    const clearMedia = () => props.onChange({ mediaId: undefined, mediaUrl: undefined, },);

    return (
        <div class="image-link-picker">
            <Show when={src()}>
                <div class="image-link-picker__preview">
                    <img src={src()} alt="" />
                </div>
            </Show>

            <div class="image-link-picker__actions">
                <button type="button" class="btn btn--secondary btn--small" onClick={() => setShowSelect(true,)}>
                    Select Media
                </button>
                <button type="button" class="btn btn--outline btn--small" onClick={() => setShowUpload(true,)}>
                    Upload New
                </button>
                <Show when={hasMedia()}>
                    <button
                        type="button"
                        class="btn btn--danger btn--small"
                        onClick={clearMedia}
                        title="Remove selected media image"
                    >
                        &times;
                    </button>
                </Show>
            </div>

            <label class="image-link-picker__field">
                <span class="image-link-picker__label">Image URL</span>
                <input
                    type="text"
                    value={props.imageUrl ?? ''}
                    placeholder="/uploads/… or https://… (optional)"
                    onInput={(e,) => props.onChange({ imageUrl: e.currentTarget.value, },)}
                />
            </label>
            <p class="image-link-picker__hint">
                <Show
                    when={urlOverrides()}
                    fallback="Pick a library image, or enter an external URL. A URL overrides the selected media image."
                >
                    The Image URL is overriding the selected media image — clear it to use the media image.
                </Show>
            </p>

            <Show when={showSelect()}>
                <MediaSelectModal types={['image',]} onSelect={pickMedia} onClose={() => setShowSelect(false,)} />
            </Show>
            <Show when={showUpload()}>
                <MediaUploadModal onUploaded={pickMedia} onClose={() => setShowUpload(false,)} />
            </Show>
        </div>
    );
};

export default ImageLinkPicker;
