import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';

export interface MediaItem {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    createdAt: string;
}

interface MediaPickerModalProps {
    type: 'image' | 'video' | 'document';
    onSelect: (media: MediaItem,) => void;
    onClose: () => void;
}

const MIME_TYPE_MAP: Record<string, string> = {
    image: 'image',
    video: 'video',
    document: 'application',
};

const MediaPickerModal: Component<MediaPickerModalProps> = (props,) => {
    const [selected, setSelected,] = createSignal<string | null>(null,);

    const [media,] = createResource(() => props.type, async (type,): Promise<MediaItem[]> => {
        const result = await cms.media.list({ type: MIME_TYPE_MAP[type], limit: 100, },);
        return (result.data || []) as unknown as MediaItem[];
    },);

    const formatSize = (bytes: number,) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024,)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1,)} MB`;
    };

    const handleConfirm = () => {
        const items = media() || [];
        const item = items.find((m: MediaItem,) => m.id === selected());
        if (item) {
            props.onSelect(item,);
        }
    };

    return (
        <ModalShell open={true} onClose={props.onClose} size="lg" class="media-picker" ariaLabel="Select media">
                <div class="media-picker__header">
                    <h2>
                        Select Existing{' '}
                        {props.type === 'image' ? 'Image' : props.type === 'video' ? 'Video' : 'Document'}
                    </h2>
                    <button class="media-picker__close" onClick={props.onClose}>&times;</button>
                </div>
                <div class="media-picker__body">
                    <Show when={!media.loading} fallback={<div class="media-picker__loading">Loading media...</div>}>
                        <Show
                            when={(media() || []).length > 0}
                            fallback={
                                <div class="empty-state">No {props.type} files found. Upload some first.</div>
                            }
                        >
                            <div class={`media-picker__grid media-picker__grid--${props.type}`}>
                                <For each={media()}>
                                    {(item: MediaItem,) => (
                                        <div
                                            class={`media-picker__item ${
                                                selected() === item.id ? 'media-picker__item--selected' : ''
                                            }`}
                                            onClick={() => setSelected(item.id,)}
                                        >
                                            <Show when={props.type === 'image'}>
                                                <img
                                                    src={item.thumbnailUrl || item.url}
                                                    alt={item.originalName}
                                                    class="media-picker__thumb"
                                                />
                                            </Show>
                                            <Show when={props.type === 'video'}>
                                                <div class="media-picker__video-thumb">
                                                    <span class="media-picker__play-icon">&#9654;</span>
                                                </div>
                                            </Show>
                                            <Show when={props.type === 'document'}>
                                                <div class="media-picker__doc-thumb">
                                                    <span class="media-picker__doc-icon">&#128196;</span>
                                                </div>
                                            </Show>
                                            <div class="media-picker__item-info">
                                                <span class="media-picker__item-name" title={item.originalName}>
                                                    {item.originalName}
                                                </span>
                                                <span class="media-picker__item-size">{formatSize(item.size,)}</span>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </div>
                <div class="media-picker__footer">
                    <button class="btn btn--secondary" onClick={props.onClose}>Cancel</button>
                    <button class="btn btn--primary" onClick={handleConfirm} disabled={!selected()}>
                        Select
                    </button>
                </div>
        </ModalShell>
    );
};

export default MediaPickerModal;
