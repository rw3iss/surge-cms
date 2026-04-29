/**
 * Image block editor — supports one or many images.
 *
 *  - Thumbnail strip across the top: each thumbnail selects its image
 *    for editing in the panel below. The "+" button at the strip's
 *    end inserts a new empty image and selects it.
 *  - Per-image settings: Select Media (existing), Upload New (new),
 *    URL (paste), alt text, caption, link, allowMaximize, remove.
 *  - Block-level settings: layout direction (horizontal / vertical),
 *    item min/max width and height with help tooltips.
 *
 * Backwards compatibility: blocks created before the multi-image
 * upgrade have a top-level `url` instead of an `images[]`. We coalesce
 * those into a single-item images array on read, and write back to the
 * new shape on first edit.
 */
import { Component, createSignal, For, Show, } from 'solid-js';
import MediaSelectModal from '../../media/MediaSelectModal';
import MediaUploadModal from '../../media/MediaUploadModal';
import { FormField, FormSection, } from '../../forms';

export interface ImageItem {
    id: string;
    url: string;
    mediaId?: string;
    alt?: string;
    caption?: string;
    link?: string;
    allowMaximize?: boolean;
    fileName?: string;
    fileSize?: number;
}

interface ImageBlockProps {
    data: Record<string, any>;
    mode: 'view' | 'edit';
    onUpdate: (data: Record<string, any>,) => void;
}

const newId = (): string =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ?
        crypto.randomUUID() :
        `img-${Date.now()}-${Math.random().toString(16,).slice(2,)}`;

const newEmptyImage = (): ImageItem => ({ id: newId(), url: '', alt: '', });

/** Resolve images[] from either the new shape or the legacy single-image
 *  fields. Pure read-only — does not mutate the caller's data. */
function resolveImages(data: Record<string, any>,): ImageItem[] {
    if (Array.isArray(data.images,) && data.images.length > 0) {
        return data.images as ImageItem[];
    }
    if (data.url) {
        return [{
            id: data.legacyImageId || 'legacy',
            url: data.url as string,
            alt: data.alt as string | undefined,
            caption: data.caption as string | undefined,
            allowMaximize: data.allowMaximize as boolean | undefined,
            mediaId: data.mediaId as string | undefined,
            fileName: data.fileName as string | undefined,
            fileSize: data.fileSize as number | undefined,
        },];
    }
    return [];
}

const ImageBlock: Component<ImageBlockProps> = (props,) => {
    const [showSelect, setShowSelect,] = createSignal(false,);
    const [showUpload, setShowUpload,] = createSignal(false,);

    const images = (): ImageItem[] => resolveImages(props.data,);
    const selectedId = (): string | null => {
        const sel = props.data.selectedImageId as string | undefined;
        const list = images();
        if (sel && list.some(i => i.id === sel,)) return sel;
        return list[0]?.id ?? null;
    };
    const selected = (): ImageItem | null => images().find(i => i.id === selectedId(),) ?? null;

    const writeImages = (next: ImageItem[], selectId?: string,) => {
        // Migrate to the new shape on any write — strip the legacy
        // single-image keys so they don't drift out of sync.
        const {
            url: _u, alt: _a, caption: _c, allowMaximize: _am,
            mediaId: _m, fileName: _f, fileSize: _fs,
            ...rest
        } = props.data;
        const update: Record<string, any> = { ...rest, images: next, };
        if (selectId !== undefined) update.selectedImageId = selectId;
        else if (props.data.selectedImageId && !next.some(i => i.id === props.data.selectedImageId,)) {
            update.selectedImageId = next[0]?.id ?? undefined;
        }
        props.onUpdate(update,);
    };

    const updateSelected = (patch: Partial<ImageItem>,) => {
        const id = selectedId();
        if (!id) return;
        const next = images().map(i => i.id === id ? { ...i, ...patch, } : i);
        writeImages(next,);
    };

    const addEmpty = () => {
        const item = newEmptyImage();
        writeImages([...images(), item,], item.id,);
    };

    const removeAt = (id: string,) => {
        writeImages(images().filter(i => i.id !== id,),);
    };

    const select = (id: string,) => {
        props.onUpdate({ ...props.data, selectedImageId: id, },);
    };

    const handleMediaSelect = (media: any,) => {
        updateSelected({
            url: media.url,
            mediaId: media.id,
            fileName: media.originalName,
            fileSize: media.size,
        },);
        setShowSelect(false,);
    };

    const handleUploadDone = (media: any,) => {
        updateSelected({
            url: media.url,
            mediaId: media.id,
            fileName: media.originalName,
            fileSize: media.size,
        },);
        setShowUpload(false,);
    };

    const updateBlock = (patch: Record<string, any>,) =>
        props.onUpdate({ ...props.data, ...patch, },);

    return (
        <div class="block-image">
            <Show when={props.mode === 'edit'} fallback={<div />}>
                {/* ─── Thumbnail strip ─── */}
                <div class="image-block-strip">
                    <For each={images()}>
                        {(img,) => (
                            <button
                                type="button"
                                class={`image-block-strip__thumb ${selectedId() === img.id ? 'is-active' : ''}`}
                                onClick={() => select(img.id,)}
                                title={img.alt || 'Image'}
                            >
                                <Show
                                    when={img.url}
                                    fallback={<span class="image-block-strip__placeholder">+</span>}
                                >
                                    <img src={img.url} alt={img.alt || ''} />
                                </Show>
                                <span
                                    class="image-block-strip__remove"
                                    role="button"
                                    title="Remove"
                                    onClick={(e,) => {
                                        e.stopPropagation();
                                        removeAt(img.id,);
                                    }}
                                >
                                    ×
                                </span>
                            </button>
                        )}
                    </For>
                    <button
                        type="button"
                        class="image-block-strip__add"
                        onClick={addEmpty}
                        title="Add image"
                    >
                        +
                    </button>
                </div>

                {/* ─── Per-image settings ─── */}
                <Show
                    when={selected()}
                    fallback={
                        <div class="form-group">
                            <small class="form-help" style={{ color: '#888', }}>
                                Click + above to add an image.
                            </small>
                        </div>
                    }
                >
                    {(item,) => (
                        <FormSection title="Selected image">
                            <FormField label="Source">
                                <div class="image-block-source">
                                    <button
                                        type="button"
                                        class="btn btn--small btn--secondary"
                                        onClick={() => setShowSelect(true,)}
                                    >
                                        Select Media
                                    </button>
                                    <button
                                        type="button"
                                        class="btn btn--small btn--secondary"
                                        onClick={() => setShowUpload(true,)}
                                    >
                                        Upload New
                                    </button>
                                    <Show when={item().url}>
                                        <span class="form-help">
                                            {item().fileName || item().url}
                                        </span>
                                    </Show>
                                </div>
                            </FormField>
                            <FormField label="URL (or paste a URL)">
                                <input
                                    type="url"
                                    value={item().url || ''}
                                    onInput={(e,) => updateSelected({ url: e.currentTarget.value, },)}
                                    placeholder="https://..."
                                />
                            </FormField>
                            <FormField label="Alt text">
                                <input
                                    type="text"
                                    value={item().alt || ''}
                                    onInput={(e,) => updateSelected({ alt: e.currentTarget.value, },)}
                                    placeholder="Describe the image"
                                />
                            </FormField>
                            <FormField label="Caption">
                                <input
                                    type="text"
                                    value={item().caption || ''}
                                    onInput={(e,) => updateSelected({ caption: e.currentTarget.value, },)}
                                    placeholder="Optional caption shown under the image"
                                />
                            </FormField>
                            <FormField label="Link URL">
                                <input
                                    type="url"
                                    value={item().link || ''}
                                    onInput={(e,) => updateSelected({ link: e.currentTarget.value, },)}
                                    placeholder="Optional — wraps the image in a link"
                                />
                            </FormField>
                            <FormField label="Allow maximize" inline>
                                <input
                                    type="checkbox"
                                    checked={item().allowMaximize === true}
                                    onChange={(e,) => updateSelected({ allowMaximize: e.currentTarget.checked, },)}
                                />
                            </FormField>
                        </FormSection>
                    )}
                </Show>

                {/* ─── Block-level layout ─── */}
                <FormSection title="Layout">
                    <FormField label="Direction" inline>
                        <select
                            value={(props.data.direction as string) || 'horizontal'}
                            onChange={(e,) => updateBlock({ direction: e.currentTarget.value, },)}
                        >
                            <option value="horizontal">Horizontal (row)</option>
                            <option value="vertical">Vertical (column)</option>
                        </select>
                    </FormField>
                    <FormField
                        label="Item min width"
                        tooltip="Smallest width each image can shrink to before the row wraps. Any valid CSS length: 200px, 25%, 12rem."
                        inline
                    >
                        <input
                            type="text"
                            value={(props.data.itemMinWidth as string) || ''}
                            onInput={(e,) => updateBlock({ itemMinWidth: e.currentTarget.value, },)}
                            placeholder="e.g. 200px, 25%"
                        />
                    </FormField>
                    <FormField
                        label="Item max width"
                        tooltip="Largest width each image can grow to. Any valid CSS length."
                        inline
                    >
                        <input
                            type="text"
                            value={(props.data.itemMaxWidth as string) || ''}
                            onInput={(e,) => updateBlock({ itemMaxWidth: e.currentTarget.value, },)}
                            placeholder="e.g. 600px, 50%"
                        />
                    </FormField>
                    <FormField
                        label="Item min height"
                        tooltip="Smallest height each image renders at. Any valid CSS length."
                        inline
                    >
                        <input
                            type="text"
                            value={(props.data.itemMinHeight as string) || ''}
                            onInput={(e,) => updateBlock({ itemMinHeight: e.currentTarget.value, },)}
                            placeholder="e.g. 100px"
                        />
                    </FormField>
                    <FormField
                        label="Item max height"
                        tooltip="Largest height each image can grow to. Any valid CSS length."
                        inline
                    >
                        <input
                            type="text"
                            value={(props.data.itemMaxHeight as string) || ''}
                            onInput={(e,) => updateBlock({ itemMaxHeight: e.currentTarget.value, },)}
                            placeholder="e.g. 400px"
                        />
                    </FormField>
                </FormSection>

                <Show when={showSelect()}>
                    <MediaSelectModal
                        types={['image',]}
                        onSelect={handleMediaSelect}
                        onClose={() => setShowSelect(false,)}
                    />
                </Show>
                <Show when={showUpload()}>
                    <MediaUploadModal
                        acceptTypes="image/*"
                        onUploaded={handleUploadDone}
                        onClose={() => setShowUpload(false,)}
                    />
                </Show>
            </Show>
        </div>
    );
};

export default ImageBlock;
