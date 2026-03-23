import { Component, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { api, } from '../../services/api';
import './MediaSelectModal.scss';

const ITEMS_PER_PAGE = 10;

export interface MediaItem {
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

interface MediaSelectModalProps {
    types?: string[];
    onSelect: (media: MediaItem,) => void;
    onClose: () => void;
}

const MediaSelectModal: Component<MediaSelectModalProps> = (props,) => {
    const [items, setItems,] = createSignal<MediaItem[]>([],);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(false,);
    const [searchText, setSearchText,] = createSignal('',);
    const [sort, setSort,] = createSignal('date_desc',);
    const [page, setPage,] = createSignal(1,);
    const [playingVideo, setPlayingVideo,] = createSignal<string | null>(null,);

    let searchTimer: ReturnType<typeof setTimeout>;

    const fetchMedia = async () => {
        setLoading(true,);
        try {
            const params = new URLSearchParams();
            if (props.types?.length) params.set('types', props.types.join(',',),);
            if (searchText()) params.set('search', searchText(),);
            params.set('sort', sort(),);
            params.set('page', String(page(),),);
            params.set('limit', String(ITEMS_PER_PAGE,),);

            const response = await api.get(`/media?${params.toString()}`,);
            if (response.success) {
                setItems((response as any).data || [],);
                setTotalPages((response as any).meta?.totalPages || 1,);
            }
        } catch (e) {
            console.error('Failed to fetch media:', e,);
        }
        setLoading(false,);
    };

    const handleSearchInput = (value: string,) => {
        setSearchText(value,);
        clearTimeout(searchTimer,);
        searchTimer = setTimeout(() => {
            setPage(1,);
            fetchMedia();
        }, 300,);
    };

    const handleSortChange = (value: string,) => {
        setSort(value,);
        setPage(1,);
        fetchMedia();
    };

    const handlePrevPage = () => {
        if (page() > 1) {
            setPage(page() - 1,);
            fetchMedia();
        }
    };

    const handleNextPage = () => {
        if (page() < totalPages()) {
            setPage(page() + 1,);
            fetchMedia();
        }
    };

    const formatSize = (bytes: number,): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024,)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1,)} MB`;
    };

    const formatDate = (dateStr: string,): string => {
        return new Date(dateStr,).toLocaleDateString();
    };

    const isVideo = (item: MediaItem,): boolean => {
        return item.mimeType.startsWith('video/',);
    };

    const isImage = (item: MediaItem,): boolean => {
        return item.mimeType.startsWith('image/',);
    };

    onMount(() => {
        fetchMedia();
    },);

    onCleanup(() => {
        clearTimeout(searchTimer,);
    },);

    return (
        <div
            class="media-select-overlay"
            onClick={(e,) => {
                if (e.target === e.currentTarget) props.onClose();
            }}
        >
            <div class="media-select-modal">
                <div class="media-select-modal__header">
                    <h2>Select Media</h2>
                    <button class="media-select-modal__close" onClick={props.onClose}>&times;</button>
                </div>

                <div class="media-select-modal__toolbar">
                    <input
                        type="text"
                        class="media-select-modal__search"
                        placeholder="Search media..."
                        value={searchText()}
                        onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                    />
                    <select
                        class="media-select-modal__sort"
                        value={sort()}
                        onChange={(e,) => handleSortChange(e.currentTarget.value,)}
                    >
                        <option value="date_desc">Date (Newest)</option>
                        <option value="date_asc">Date (Oldest)</option>
                        <option value="title_asc">Name (A-Z)</option>
                        <option value="title_desc">Name (Z-A)</option>
                        <option value="size_desc">Size (Largest)</option>
                        <option value="size_asc">Size (Smallest)</option>
                    </select>
                </div>

                <div class="media-select-modal__body">
                    <Show when={!loading()} fallback={<div class="media-select-modal__loading">Loading...</div>}>
                        <Show
                            when={items().length > 0}
                            fallback={<div class="media-select-modal__empty">No media found</div>}
                        >
                            <div class="media-select-modal__grid">
                                <For each={items()}>
                                    {(item,) => (
                                        <div class="media-select-modal__card">
                                            <div class="media-select-modal__preview">
                                                <Show when={isVideo(item,) && playingVideo() === item.id}>
                                                    <video
                                                        class="media-select-modal__video"
                                                        src={item.url}
                                                        controls
                                                        autoplay
                                                    />
                                                </Show>
                                                <Show when={isVideo(item,) && playingVideo() !== item.id}>
                                                    <div class="media-select-modal__thumb-wrap">
                                                        <Show
                                                            when={item.thumbnailUrl}
                                                            fallback={
                                                                <div class="media-select-modal__thumb-placeholder">
                                                                    <span>&#9654;</span>
                                                                </div>
                                                            }
                                                        >
                                                            <img
                                                                src={item.thumbnailUrl}
                                                                alt={item.title || item.originalName}
                                                                class="media-select-modal__thumb"
                                                            />
                                                        </Show>
                                                        <button
                                                            class="media-select-modal__play-btn"
                                                            onClick={() => setPlayingVideo(item.id,)}
                                                            title="Play video"
                                                        >
                                                            <span class="media-select-modal__play-icon">&#9654;</span>
                                                        </button>
                                                    </div>
                                                </Show>
                                                <Show when={isImage(item,)}>
                                                    <img
                                                        src={item.thumbnailUrl || item.url}
                                                        alt={item.title || item.originalName}
                                                        class="media-select-modal__thumb"
                                                    />
                                                </Show>
                                                <Show when={!isImage(item,) && !isVideo(item,)}>
                                                    <div class="media-select-modal__thumb-placeholder">
                                                        <span>&#128196;</span>
                                                    </div>
                                                </Show>
                                            </div>
                                            <div class="media-select-modal__info">
                                                <span
                                                    class="media-select-modal__name"
                                                    title={item.title || item.originalName}
                                                >
                                                    {item.title || item.originalName}
                                                </span>
                                                <span class="media-select-modal__meta">
                                                    {formatDate(item.createdAt,)} &middot; {formatSize(item.size,)}
                                                </span>
                                                <button
                                                    class="media-select-modal__select-btn"
                                                    onClick={() => props.onSelect(item,)}
                                                >
                                                    Select
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </Show>
                </div>

                <Show when={!loading() && items().length > 0}>
                    <div class="media-select-modal__pagination">
                        <button
                            class="media-select-modal__page-btn"
                            onClick={handlePrevPage}
                            disabled={page() <= 1}
                        >
                            Previous
                        </button>
                        <span class="media-select-modal__page-info">
                            Page {page()} of {totalPages()}
                        </span>
                        <button
                            class="media-select-modal__page-btn"
                            onClick={handleNextPage}
                            disabled={page() >= totalPages()}
                        >
                            Next
                        </button>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default MediaSelectModal;
