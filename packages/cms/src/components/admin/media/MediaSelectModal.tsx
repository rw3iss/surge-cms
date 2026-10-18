import { Component, createSignal, For, onMount, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import ModalShell from '../common/ModalShell';
import MediaTypeFilter, { MEDIA_KINDS, type MediaKind, } from './MediaTypeFilter';
import MediaSearchInput from './MediaSearchInput';
import { formatSize, } from './mediaUtils';
import MediaUploadModal from './MediaUploadModal';
import MediaViewerModal from './MediaViewerModal';
import './MediaSelectModal.scss';

const ITEMS_PER_PAGE = 15;

export interface MediaItem {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    title?: string;
    alt?: string;
    createdAt: string;
    /** Encoded-video details (poster etc.), when the item is an encoded video. */
    video?: { posterUrl?: string | null; } | null;
}

interface MediaSelectModalProps {
    types?: string[];
    onSelect: (media: MediaItem,) => void;
    onClose: () => void;
    /**
     * Multi-select: each card's button toggles it into a selection kept across
     * pages and searches; a footer button hands the whole set to `onSelectMany`
     * (`onSelect` is then unused).
     */
    multiple?: boolean;
    onSelectMany?: (media: MediaItem[],) => void;
    /** Media that cannot be picked (e.g. already in the gallery) — shown with `disabledLabel`. */
    disabledIds?: string[];
    disabledLabel?: string;
    /** Header text (default "Select Media"). */
    title?: string;
    /** Footer button text in multi-select mode (default "Add selected"). */
    confirmLabel?: string;
}

const MediaSelectModal: Component<MediaSelectModalProps> = (props,) => {
    const [items, setItems,] = createSignal<MediaItem[]>([],);
    const [totalPages, setTotalPages,] = createSignal(1,);
    const [loading, setLoading,] = createSignal(false,);
    const [searchText, setSearchText,] = createSignal('',);
    const [sort, setSort,] = createSignal('date_desc',);
    const [page, setPage,] = createSignal(1,);
    const [showUpload, setShowUpload,] = createSignal(false,);
    /** Item open in the full-size lightbox (selecting still needs the Select button). */
    const [viewing, setViewing,] = createSignal<MediaItem | null>(null,);
    /** Multi-select: picked items by id, in pick order. */
    const [picked, setPicked,] = createSignal<MediaItem[]>([],);
    const isPicked = (id: string,) => picked().some((m,) => m.id === id,);
    const isDisabled = (id: string,) => (props.disabledIds ?? []).includes(id,);
    const choose = (item: MediaItem,) => {
        if (isDisabled(item.id,)) return;
        if (!props.multiple) return props.onSelect(item,);
        setPicked((cur,) => (cur.some((m,) => m.id === item.id,) ? cur.filter((m,) => m.id !== item.id,) : [...cur, item,]));
    };

    /** Kinds this picker may show: the caller's `types`, else all four. */
    const allowedKinds = (): MediaKind[] => {
        const all = MEDIA_KINDS.map((k,) => k.key);
        const t = (props.types ?? []).filter((x,): x is MediaKind => all.includes(x as MediaKind,));
        return t.length ? t : all;
    };
    const [kinds, setKinds,] = createSignal<MediaKind[]>([],);
    const handleKindsChange = (next: MediaKind[],) => {
        setKinds(next,);
        setPage(1,);
        fetchMedia();
    };


    const fetchMedia = async () => {
        setLoading(true,);
        try {
            const query: Record<string, string | number> = {
                sort: sort(),
                page: page(),
                limit: ITEMS_PER_PAGE,
            };
            const t = kinds().length ? kinds() : props.types;
            if (t?.length) query.types = t.join(',',);
            if (searchText()) query.search = searchText();

            const result = await cms.media.list(query,);
            setItems((result.data || []) as unknown as MediaItem[],);
            setTotalPages(result.meta?.totalPages || 1,);
        } catch (e) {
            console.error('Failed to fetch media:', e,);
        }
        setLoading(false,);
    };

    /** After uploading from within this modal, close the uploader, jump to
     *  the newest-first view and refresh so the new item shows up. */
    const handleUploaded = () => {
        setShowUpload(false,);
        setSearchText('',);
        setSort('date_desc',);
        setPage(1,);
        fetchMedia();
    };

    /** Debounced by MediaSearchInput; runs once the user pauses / presses Enter / clears. */
    const handleSearch = (value: string,) => {
        setSearchText(value,);
        setPage(1,);
        fetchMedia();
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


    return (
        <ModalShell
            open={true}
            onClose={props.onClose}
            size="lg"
            class="media-select-modal"
            ariaLabel="Select Media"
            dismissOnEscape={!viewing() && !showUpload()}
        >
                <div class="media-select-modal__header">
                    <h2>{props.title ?? 'Select Media'}</h2>
                    <button class="media-select-modal__close" onClick={props.onClose}>&times;</button>
                </div>

                <div class="media-select-modal__toolbar">
                    <Show when={allowedKinds().length > 1}>
                        <MediaTypeFilter value={kinds()} onChange={handleKindsChange} kinds={allowedKinds()} />
                    </Show>
                    <MediaSearchInput class="media-select-modal__search" value={searchText()} onSearch={handleSearch} />
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
                        <div class="media-select-modal__grid">
                            {/* Upload New — always the first tile; opens the
                                uploader, then refreshes this grid on success. */}
                            <div
                                class="media-select-modal__card media-select-modal__card--upload"
                                role="button"
                                tabindex="0"
                                onClick={() => setShowUpload(true,)}
                                onKeyDown={(e,) => { if (e.key === 'Enter' || e.key === ' ') setShowUpload(true,); }}
                            >
                                <div class="media-select-modal__upload-tile">
                                    <span class="media-select-modal__upload-icon">+</span>
                                    <span class="media-select-modal__upload-label">Upload New</span>
                                </div>
                            </div>
                            <Show when={items().length === 0}>
                                <div class="media-select-modal__empty-inline">No media found</div>
                            </Show>
                            <div style={{ display: 'contents', }}>
                                <For each={items()}>
                                    {(item,) => (
                                        <div
                                            class="media-select-modal__card media-select-modal__card--item"
                                            classList={{
                                                'media-select-modal__card--picked': isPicked(item.id,),
                                                'media-select-modal__card--disabled': isDisabled(item.id,),
                                            }}
                                            title={item.title || item.originalName}
                                            role="button"
                                            tabindex="0"
                                            onClick={() => setViewing(item,)}
                                            onKeyDown={(e,) => {
                                                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                                                    e.preventDefault();
                                                    setViewing(item,);
                                                }
                                            }}
                                        >
                                            <div class="media-select-modal__preview">
                                                <Show when={isVideo(item,)}>
                                                    <Show
                                                        when={item.video?.posterUrl || item.thumbnailUrl}
                                                        fallback={
                                                            <div class="media-select-modal__thumb-placeholder">
                                                                <span>&#9654;</span>
                                                            </div>
                                                        }
                                                    >
                                                        {(src,) => (
                                                            <img
                                                                src={src()}
                                                                alt={item.alt || item.title || item.originalName}
                                                                class="media-select-modal__thumb"
                                                                loading="lazy"
                                                            />
                                                        )}
                                                    </Show>
                                                    <span class="media-select-modal__play-btn" aria-hidden="true">
                                                        <span class="media-select-modal__play-icon">&#9654;</span>
                                                    </span>
                                                </Show>
                                                <Show when={isImage(item,)}>
                                                    <img
                                                        src={item.thumbnailUrl || item.url}
                                                        alt={item.alt || item.title || item.originalName}
                                                        class="media-select-modal__thumb"
                                                        loading="lazy"
                                                    />
                                                </Show>
                                                <Show when={!isImage(item,) && !isVideo(item,)}>
                                                    <div class="media-select-modal__thumb-placeholder">
                                                        <span>&#128196;</span>
                                                    </div>
                                                </Show>
                                            </div>
                                            <div class="media-select-modal__info">
                                                <span class="media-select-modal__name">
                                                    {item.title || item.originalName}
                                                </span>
                                                <span class="media-select-modal__meta">
                                                    {formatDate(item.createdAt,)} &middot; {formatSize(item.size,)}
                                                </span>
                                                <button
                                                    class="media-select-modal__select-btn"
                                                    classList={{ 'media-select-modal__select-btn--picked': isPicked(item.id,), }}
                                                    disabled={isDisabled(item.id,)}
                                                    aria-pressed={props.multiple ? isPicked(item.id,) : undefined}
                                                    onClick={(e,) => {
                                                        e.stopPropagation();
                                                        choose(item,);
                                                    }}
                                                >
                                                    {isDisabled(item.id,)
                                                        ? (props.disabledLabel ?? 'Unavailable')
                                                        : props.multiple ? (isPicked(item.id,) ? '✓ Selected' : 'Select') : 'Select'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </div>
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

                <Show when={props.multiple}>
                    <div class="media-select-modal__footer">
                        <span class="media-select-modal__footer-count">
                            {picked().length ? `${picked().length} selected` : 'Select one or more items'}
                        </span>
                        <Show when={picked().length}>
                            <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => setPicked([],)}>Clear</button>
                        </Show>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onClose}>Cancel</button>
                        <button
                            type="button"
                            class="ui-button ui-button--primary ui-button--sm"
                            disabled={!picked().length}
                            onClick={() => props.onSelectMany?.(picked(),)}
                        >
                            {props.confirmLabel ?? 'Add selected'}{picked().length ? ` (${picked().length})` : ''}
                        </button>
                    </div>
                </Show>

                <Show when={viewing()}>
                    {(m,) => <MediaViewerModal media={m() as never} onClose={() => setViewing(null,)} />}
                </Show>

                <Show when={showUpload()}>
                    <MediaUploadModal
                        acceptTypes={props.types?.length ? props.types.map(t => `${t}/*`).join(',',) : undefined}
                        onUploaded={handleUploaded}
                        onClose={() => setShowUpload(false,)}
                    />
                </Show>
        </ModalShell>
    );
};

export default MediaSelectModal;
