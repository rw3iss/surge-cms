import { A, useSearchParams, } from '@solidjs/router';
import type { Media, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show, } from 'solid-js';
import MediaEditModal from '../../components/admin/media/MediaEditModal';
import MediaSearchInput from '../../components/admin/media/MediaSearchInput';
import Checkbox from '../../components/ui/Checkbox';
import { useToast, } from '../../components/common/toast';
import MediaTypeFilter, { type MediaKind, } from '../../components/admin/media/MediaTypeFilter';
import MediaViewerModal from '../../components/admin/media/MediaViewerModal';
import { downloadFile, formatSize, getTypeLabel, } from '../../components/admin/media/mediaUtils';
import RenditionChips from '../../components/admin/media/RenditionChips';
import { formatDuration, } from '../../components/admin/media/videoFormat';
import { cms, } from '../../services/cmsClient';
import { cancelMedia, defaultTitle, startUpload, uploadsVersion, usesMultipart, } from '../../stores/uploads';
import { confirmMediaDelete, isMediaInUseError, } from '../../stores/mediaDeleteConfirm';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import AdminTitle from '../../components/admin/common/AdminTitle';
import Pagination from '../../components/admin/common/Pagination';
import '../../components/admin/media/VideoMedia.scss';


const POLL_MS = 3000;
const ACTIVE_JOB = new Set(['queued', 'downloading', 'probing', 'encoding', 'uploading', 'finalizing',],);

/** A tile is still being encoded (keep polling while any is). */
function isProcessing(m: Media,): boolean {
    return m.status === 'processing' || (!!m.video?.jobStatus && ACTIVE_JOB.has(m.video.jobStatus,));
}

/** An encoded video (has a `media_videos` row). */
const isEncodedVideo = (m: Media,) => !!m.video;

/**
 * Library tile preview for a video: the poster as an <img> (never a <video> —
 * a grid of them would download every file), duration, access + teaser
 * badges, and while encoding an overall bar + per-quality chips.
 */
const VideoTile: Component<{ m: Media; onCancel?: () => void; cancelling?: boolean; }> = (p,) => {
    const poster = () => p.m.video?.posterUrl ?? p.m.thumbnailUrl ?? null;
    return (
        <div class="media-video-tile">
            <Show when={isProcessing(p.m,) && p.onCancel}>
                <button
                    type="button"
                    class="media-cancel-btn"
                    disabled={p.cancelling}
                    title="Stop processing and delete this video"
                    aria-label={`Cancel processing of ${(p.m as { title?: string | null; }).title || p.m.originalName}`}
                    onClick={(e,) => { e.stopPropagation(); p.onCancel?.(); }}
                >
                    &times; Cancel
                </button>
            </Show>
            <Show when={poster()} fallback={<div class="media-video-tile__placeholder" aria-hidden="true">&#9654;</div>}>
                <img class="media-video-tile__poster" src={poster()!} alt={p.m.alt || p.m.originalName} loading="lazy" />
            </Show>
            <div class="media-video-tile__badges">
                <Show when={p.m.accessLevel === 'private'}>
                    <span class="media-video-tile__badge" title="Private — full video for members only">&#128274; Private</span>
                </Show>
                <Show when={p.m.video?.hasTeaser}>
                    <span class="media-video-tile__badge media-video-tile__badge--teaser">Teaser</span>
                </Show>
                <Show when={p.m.status === 'failed'}>
                    <span class="media-video-tile__badge media-video-tile__badge--failed">Failed</span>
                </Show>
            </div>
            <Show when={!isProcessing(p.m,) && p.m.durationMs}>
                <span class="media-video-tile__duration">{formatDuration(p.m.durationMs,)}</span>
            </Show>
            <Show when={isProcessing(p.m,)}>
                <div class="media-video-tile__processing">
                    <div>
                        {p.m.video?.blockedReason ? `Waiting (${p.m.video.blockedReason.replace('_', ' ',)})` : 'Processing'}{' '}
                        {Math.floor(p.m.video?.progress ?? 0,)}%
                    </div>
                    <div class="video-progress">
                        <div class="video-progress__fill" style={{ width: `${p.m.video?.progress ?? 0}%`, }} />
                    </div>
                    <RenditionChips renditions={p.m.video?.renditions ?? []} />
                </div>
            </Show>
        </div>
    );
};

/**
 * A plain (not encoded) video tile: a placeholder until the tile scrolls into
 * view, then `<video preload="metadata">` — a page of 100 old MP4 uploads
 * otherwise opened 100 range requests at load.
 */
const LazyVideo: Component<{ src: string; }> = (p,) => {
    const [visible, setVisible,] = createSignal(false,);
    let el: HTMLDivElement | undefined;
    onMount(() => {
        if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true,); return; }
        const io = new IntersectionObserver((entries,) => {
            if (entries.some((e,) => e.isIntersecting,)) { setVisible(true,); io.disconnect(); }
        }, { rootMargin: '200px', },);
        io.observe(el,);
        onCleanup(() => io.disconnect());
    },);
    return (
        <div ref={el} class="media-grid__lazy-video">
            <Show when={visible()} fallback={<div class="media-video-tile__placeholder" aria-hidden="true">&#9654;</div>}>
                <video src={p.src} preload="metadata" muted playsinline />
            </Show>
        </div>
    );
};

/** Page sizes offered (server max 200); the choice is remembered per browser. */
const PAGE_SIZES = [25, 50, 100, 200,];
const PAGE_SIZE_KEY = 'sitesurge.admin.media.pageSize';
function storedPageSize(): number {
    try {
        const n = Number(localStorage.getItem(PAGE_SIZE_KEY,),);
        return PAGE_SIZES.includes(n,) ? n : 50;
    } catch {
        return 50;
    }
}

const AdminMedia: Component = () => {
    // Current page lives in the URL (?page=), so reload / back / a shared link
    // restore it; the page size lives in localStorage.
    const [params, setParams,] = useSearchParams<{ page?: string; }>();
    const page = () => Math.max(1, Number(params.page,) || 1,);
    const setPage = (n: number,) => setParams({ page: n > 1 ? String(n,) : undefined, },);
    const [pageSize, setPageSizeRaw,] = createSignal(storedPageSize(),);
    const setPageSize = (n: number,) => {
        setPageSizeRaw(n,);
        try { localStorage.setItem(PAGE_SIZE_KEY, String(n,),); } catch { /* private mode */ }
    };
    const [meta, setMeta,] = createSignal<{ total: number; totalPages: number; } | null>(null,);
    // Type filter: any combination of types; none selected = All.
    const [types, setTypes,] = createSignal<MediaKind[]>([],);
    const toast = useToast();
    const [searchQuery, setSearchQuery,] = createSignal('',);
    const [sortBy, setSortBy,] = createSignal('date_desc',);
    const [editingMedia, setEditingMedia,] = createSignal<any>(null,);
    const [viewingMedia, setViewingMedia,] = createSignal<any>(null,);

    const mediaQuery = () => {
        const q: Record<string, string> = {};
        if (types().length) q.types = types().join(',',);
        if (searchQuery()) q.search = searchQuery();
        if (sortBy()) q.sort = sortBy();
        q.page = String(page(),);
        q.limit = String(pageSize(),);
        return q;
    };

    // A failed fetch is an ERROR state (with Retry), not "No media found." —
    // an empty library and a 500 must not look the same.
    const [listError, setListError,] = createSignal<string | null>(null,);
    const [media, { refetch, },] = createResource(mediaQuery, async (q,) => {
        try {
            const res = await cms.media.list(q as any,);
            const m = res.meta as { total?: number; totalPages?: number; } | undefined;
            setMeta({ total: m?.total ?? res.data.length, totalPages: Math.max(1, m?.totalPages ?? 1,), },);
            setListError(null,);
            return res.data as Media[];
        } catch (e) {
            setListError((e as Error)?.message || 'Could not load the media library.',);
            return [] as Media[];
        }
    },);

    // A new filter, search, sort or page size starts again at page 1.
    createEffect(on([types, searchQuery, sortBy, pageSize,], () => setPage(1,), { defer: true, },),);
    // Past the last page (items deleted, smaller page size): go to the last one.
    createEffect(() => {
        const m = meta();
        if (m && page() > m.totalPages) setPage(m.totalPages,);
    },);

    /** Refetch bypassing the client SWR cache (a cached list would hide progress). */
    const refetchFresh = async () => {
        try { await cms.cache.invalidatePrefix(`${cms.config.namespace}:media:`,); } catch { /* ignore */ }
        refetch();
    };

    // Poll every 3 s while any visible item is encoding; stop when none is.
    // `.latest` (not `media()`) so a refetch never suspends the page.
    createEffect(() => {
        const list = media.latest ?? [];
        if (!isFeatureEnabled('video',) || !list.some(isProcessing,)) return;
        const t = setTimeout(() => void refetchFresh(), POLL_MS,);
        onCleanup(() => clearTimeout(t,));
    },);

    // A direct upload finished in the tray → show the new item.
    createEffect(on(uploadsVersion, () => void refetchFresh(), { defer: true, },),);

    /**
     * Upload any number of files (picker or drop). Large files and videos go
     * straight to storage (the upload tray shows progress; the list refetches
     * when each completes); the rest through the classic upload, one at a time.
     */
    const [uploading, setUploading,] = createSignal(0,);
    const uploadFiles = async (files: File[],) => {
        let failed = 0;
        let classic = 0;
        for (const file of files) {
            if (usesMultipart(file,)) {
                startUpload(file,);
                continue;
            }
            setUploading((n,) => n + 1,);
            try {
                await cms.media.upload(file, { title: defaultTitle(file.name,), },);
                classic++;
            } catch (e) {
                failed++;
                toast.error(`${file.name}: ${(e as Error)?.message || 'Upload failed.'}`,);
            } finally {
                setUploading((n,) => n - 1,);
            }
        }
        if (classic) {
            toast.success(classic === 1 ? 'File uploaded.' : `${classic} files uploaded.`,);
            await refetchFresh();
        }
        return failed;
    };

    const handleUpload = (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const files = [...(input.files ?? []),];
        input.value = '';
        if (files.length) void uploadFiles(files,);
    };

    // Drag files anywhere on the page to upload them.
    const [dragging, setDragging,] = createSignal(false,);
    let dragDepth = 0;
    const hasFiles = (e: DragEvent,) => [...(e.dataTransfer?.types ?? []),].includes('Files',);
    const onDragEnter = (e: DragEvent,) => {
        if (!hasFiles(e,)) return;
        e.preventDefault();
        dragDepth++;
        setDragging(true,);
    };
    const onDragLeave = () => {
        dragDepth = Math.max(0, dragDepth - 1,);
        if (!dragDepth) setDragging(false,);
    };
    const onDrop = (e: DragEvent,) => {
        if (!hasFiles(e,)) return;
        e.preventDefault();
        dragDepth = 0;
        setDragging(false,);
        const files = [...(e.dataTransfer?.files ?? []),];
        if (files.length) void uploadFiles(files,);
    };

    // ─── Selection (bulk delete) ─────────────────────────────────────
    const [selecting, setSelecting,] = createSignal(false,);
    const [selected, setSelected,] = createSignal<Set<string>>(new Set(),);
    const isSelected = (id: string,) => selected().has(id,);
    const toggleSelected = (id: string, on?: boolean,) => {
        const next = new Set(selected(),);
        if (on ?? !next.has(id,)) next.add(id,);
        else next.delete(id,);
        setSelected(next,);
    };
    const pageIds = () => (media.latest ?? []).map((m,) => m.id);
    const allOnPage = () => pageIds().length > 0 && pageIds().every(isSelected,);
    const stopSelecting = () => { setSelecting(false,); setSelected(new Set<string>(),); };
    const [bulkBusy, setBulkBusy,] = createSignal(false,);
    const bulkDelete = async () => {
        const ids = [...selected(),];
        if (!ids.length) return;
        const ok = await confirmMediaDelete({
            ids,
            title: ids.length === 1 ? 'Delete 1 file?' : `Delete ${ids.length} files?`,
            message: `Delete ${ids.length === 1 ? 'this file' : `these ${ids.length} files`} from the library and storage? This cannot be undone.`,
        },);
        if (!ok.confirmed) return;
        setBulkBusy(true,);
        try {
            const r = await cms.media.bulkRemove(ids, { force: ok.force, },);
            if (r.deleted.length) toast.success(r.deleted.length === 1 ? '1 file deleted.' : `${r.deleted.length} files deleted.`,);
            if (r.failed.length) toast.error(`${r.failed.length} could not be deleted.`,);
            stopSelecting();
        } catch (err) {
            toast.error(isMediaInUseError(err,)
                ? 'Some of these files were just put to use — nothing was deleted. Try again to see where.'
                : (err as Error)?.message || 'Delete failed.',);
        } finally {
            setBulkBusy(false,);
            await refetchFresh();
        }
    };

    // ─── "In gallery" chips + usage badges for the visible page ──────
    const [inGallery, setInGallery,] = createSignal<Record<string, string>>({},);
    createEffect(on(() => media.latest, (list,) => {
        if (!list?.length || !isFeatureEnabled('gallery',)) { setInGallery({},); return; }
        cms.gallery.admin.mediaLinks(list.map((m,) => m.id),).then(setInGallery,).catch(() => setInGallery({},),);
    },),);
    const [showUsage, setShowUsage,] = createSignal(false,);
    const [usageCounts, setUsageCounts,] = createSignal<Record<string, number> | null>(null,);
    createEffect(on([showUsage, () => media.latest,], async ([on, list,],) => {
        if (!on || !list?.length) { setUsageCounts(null,); return; }
        try {
            const ids = list.map((m,) => m.id);
            const counts: Record<string, number> = {};
            for (let i = 0; i < ids.length; i += 100) {
                const usage = await cms.media.usage(ids.slice(i, i + 100,),);
                for (const [id, u,] of Object.entries(usage,)) counts[id] = u.length;
            }
            setUsageCounts(counts,);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not load usage.',);
            setShowUsage(false,);
        }
    },),);

    /** Stop a video's encode and delete it (files, row, gallery items made from it). */
    const [cancellingId, setCancellingId,] = createSignal<string | null>(null,);
    const handleCancel = async (m: Media,) => {
        const ok = await confirmMediaDelete({
            ids: [m.id,], title: 'Stop processing?', confirmLabel: 'Stop and delete',
            message: `Stop processing "${(m as { title?: string | null; }).title || m.originalName}" and delete it?`,
            // A discard removes the gallery item made from the upload too.
            ignoreKinds: ['gallery_item',],
        },);
        if (!ok.confirmed) return;
        setCancellingId(m.id,);
        try {
            await cancelMedia(m.id, { force: ok.force, },);
            await refetchFresh();
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not cancel.',);
        } finally {
            setCancellingId(null,);
        }
    };

    const startEdit = (item: any, e: Event,) => {
        e.stopPropagation();
        setEditingMedia(item,);
    };

    const closeEditModal = () => {
        setEditingMedia(null,);
    };

    const handleMediaSaved = (_updated: any,) => {
        setEditingMedia(null,);
        refetch();
    };

    const handleMediaDeleted = (_id: string,) => {
        setEditingMedia(null,);
        refetch();
    };

    const handleDelete = async (m: Media, e: Event,) => {
        e.stopPropagation();
        const processing = isProcessing(m,);
        const ok = await confirmMediaDelete({
            ids: [m.id,], ignoreKinds: processing ? ['gallery_item',] : [],
        },);
        if (!ok.confirmed) return;
        try {
            // Still encoding: the same cancel path (stops the encode, purges its
            // files, drops its upload row and any gallery item made from it).
            if (processing) await cancelMedia(m.id, { force: ok.force, },);
            else await cms.media.remove(m.id, { force: ok.force, },);
        } catch (err) {
            toast.error(isMediaInUseError(err,)
                ? 'This file was just put to use somewhere — it was not deleted. Try again to see where.'
                : (err as Error)?.message || 'Delete failed.',);
        }
        refetch();
    };

    const handleDownload = (m: any, e: Event,) => {
        e.stopPropagation();
        downloadFile(m.url, m.originalName,);
    };

    const openModal = (m: any,) => {
        setViewingMedia(m,);
    };

    const closeModal = () => {
        setViewingMedia(null,);
    };


    /** The page buttons + "Per page" row — rendered above AND below the grid. */
    const pager = (where: 'top' | 'bottom',) => (
        <div class={`media-pagination media-pagination--${where}`}>
            <Pagination
                page={page()}
                totalPages={meta()?.totalPages ?? 1}
                total={meta()?.total}
                limit={pageSize()}
                onPageChange={(n,) => { setPage(n,); window.scrollTo({ top: 0, },); }}
                alwaysShow
            />
            <label class="media-pagination__size">
                <span>Per page</span>
                <select value={pageSize()} onChange={(e,) => setPageSize(Number(e.currentTarget.value,),)}>
                    <For each={PAGE_SIZES}>{(n,) => <option value={n} selected={n === pageSize()}>{n}</option>}</For>
                </select>
            </label>
        </div>
    );

    /** Clicking a tile: toggles it while selecting, else opens the viewer. */
    const activate = (m: Media,) => (selecting() ? toggleSelected(m.id,) : openModal(m,));

    return (
        <div
            class={`media-library ${dragging() ? 'media-library--dragging' : ''}`}
            onDragEnter={onDragEnter}
            onDragOver={(e,) => { if (hasFiles(e,)) e.preventDefault(); }}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <AdminTitle>Media</AdminTitle>
            <div class="admin-header">
                <h1>Media Library</h1>
                <div class="admin-header__actions">
                    <A href="/admin/media/settings" class="ui-button ui-button--secondary">Settings</A>
                    <button
                        type="button"
                        class="ui-button ui-button--secondary"
                        aria-pressed={selecting()}
                        onClick={() => (selecting() ? stopSelecting() : setSelecting(true,))}
                    >
                        {selecting() ? 'Done' : 'Select'}
                    </button>
                    <label class="ui-button ui-button--primary">
                        {uploading() ? `Uploading ${uploading()}…` : 'Upload Files'}
                        <input
                            type="file"
                            multiple
                            onChange={handleUpload}
                            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.zip"
                            class="media-library__file-input"
                        />
                    </label>
                </div>
            </div>

            <Show when={dragging()}>
                <div class="media-library__drop" aria-hidden="true">Drop files to upload</div>
            </Show>

            <div class="media-filters">
                <MediaTypeFilter value={types()} onChange={setTypes} />
                <MediaSearchInput
                    class="media-filters__search"
                    value={searchQuery()}
                    onSearch={setSearchQuery}
                    placeholder="Search by title or description..."
                />
                <div class="form-group media-filters__sort">
                    <select value={sortBy()} onChange={(e,) => setSortBy(e.currentTarget.value,)} aria-label="Sort">
                        <option value="date_desc">Newest First</option>
                        <option value="date_asc">Oldest First</option>
                        <option value="title_asc">Title A-Z</option>
                        <option value="title_desc">Title Z-A</option>
                        <option value="size_desc">Largest First</option>
                        <option value="size_asc">Smallest First</option>
                    </select>
                </div>
                <button
                    type="button"
                    class="ui-button ui-button--sm ui-button--secondary"
                    aria-pressed={showUsage()}
                    title="Show which files on this page are used somewhere (pages, posts, blocks, gallery, …)"
                    onClick={() => setShowUsage(!showUsage(),)}
                >
                    {showUsage() ? 'Hide usage' : 'Show usage'}
                </button>
            </div>

            <Show when={selecting()}>
                <div class="media-bulk-bar" role="toolbar" aria-label="Selected media">
                    <Checkbox
                        checked={allOnPage()}
                        onChange={(on,) => { for (const id of pageIds()) toggleSelected(id, on,); }}
                        label="Select all on this page"
                    />
                    <span class="media-bulk-bar__count">{selected().size} selected</span>
                    <button
                        type="button"
                        class="ui-button ui-button--sm ui-button--danger"
                        disabled={!selected().size || bulkBusy()}
                        onClick={() => void bulkDelete()}
                    >
                        {bulkBusy() ? 'Deleting…' : 'Delete'}
                    </button>
                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={stopSelecting}>Cancel</button>
                </div>
            </Show>

            <Show when={listError()}>
                <div class="alert alert--error media-library__error" role="alert">
                    <span>Couldn't load the media library: {listError()}</span>
                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" onClick={() => void refetchFresh()}>Retry</button>
                </div>
            </Show>

            {pager('top',)}
            <Show
                when={media.latest?.length}
                fallback={
                    <Show when={!listError()}>
                        <div class="empty-state">
                            {media.loading ? 'Loading...' : 'No media found.'}
                        </div>
                    </Show>
                }
            >
                <div class="media-grid">
                    <For each={media.latest}>
                        {(m: any,) => (
                            <div
                                class="media-grid__item"
                                classList={{ 'is-selected': selecting() && isSelected(m.id,), }}
                                onClick={() => activate(m,)}
                            >
                                <Show when={selecting()}>
                                    <div class="media-grid__select" onClick={(e,) => e.stopPropagation()}>
                                        <Checkbox
                                            checked={isSelected(m.id,)}
                                            onChange={(on,) => toggleSelected(m.id, on,)}
                                            label={<span class="sr-only">Select {m.title || m.originalName}</span>}
                                        />
                                    </div>
                                </Show>
                                <button
                                    type="button"
                                    class="media-grid__preview media-grid__open"
                                    aria-label={selecting() ? `Select ${m.title || m.originalName}` : `View ${m.title || m.originalName}`}
                                    onClick={(e,) => { e.stopPropagation(); activate(m,); }}
                                >
                                    <Show when={m.mimeType?.startsWith('image/',)}>
                                        <img src={m.thumbnailUrl || m.url} alt={m.alt || m.title || m.originalName} loading="lazy" decoding="async" />
                                    </Show>
                                    <Show when={m.mimeType?.startsWith('video/',)}>
                                        <Show
                                            when={isEncodedVideo(m,)}
                                            fallback={<LazyVideo src={m.url} />}
                                        >
                                            <VideoTile m={m} onCancel={() => void handleCancel(m,)} cancelling={cancellingId() === m.id} />
                                        </Show>
                                    </Show>
                                    <Show
                                        when={!m.mimeType?.startsWith('image/',) && !m.mimeType?.startsWith('video/',)}
                                    >
                                        <div class="media-grid__file-icon">
                                            <span>{getTypeLabel(m.mimeType,)}</span>
                                        </div>
                                    </Show>
                                </button>

                                <div class="media-grid__info">
                                    <div class="media-grid__name" title={m.title || m.originalName}>
                                        {m.title || m.originalName}
                                    </div>
                                    <Show when={m.title}>
                                        <div class="media-grid__filename">{m.originalName}</div>
                                    </Show>
                                    <Show when={m.caption}>
                                        <div class="media-grid__description">{m.caption}</div>
                                    </Show>
                                    <div class="media-grid__meta">
                                        <span>{getTypeLabel(m.mimeType,)}</span>
                                        <span>{formatSize(m.size,)}</span>
                                        <span>{new Date(m.createdAt,).toLocaleDateString()}</span>
                                    </div>
                                    <Show when={inGallery()[m.id] || usageCounts()}>
                                        <div class="media-grid__chips">
                                            <Show when={inGallery()[m.id]}>
                                                <span class="media-grid__chip media-grid__chip--gallery">In gallery</span>
                                            </Show>
                                            <Show when={usageCounts()}>
                                                {(c,) => (
                                                    <Show
                                                        when={(c()[m.id] ?? 0) > 0}
                                                        fallback={<span class="media-grid__chip media-grid__chip--unused">Unused</span>}
                                                    >
                                                        <span class="media-grid__chip">Used ×{c()[m.id]}</span>
                                                    </Show>
                                                )}
                                            </Show>
                                        </div>
                                    </Show>
                                    <div class="media-grid__actions">
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            onClick={(e,) => startEdit(m, e,)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            onClick={(e,) => handleDownload(m, e,)}
                                            title="Download"
                                            aria-label={`Download ${m.title || m.originalName}`}
                                        >
                                            &#8595;
                                        </button>
                                        <button
                                            type="button"
                                            class="ui-button ui-button--sm ui-button--danger"
                                            onClick={(e,) => handleDelete(m, e,)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>

            {pager('bottom',)}

            {/* Media Edit Modal */}
            <Show when={editingMedia()}>
                {(m,) => (
                    <MediaEditModal
                        media={m()}
                        onClose={closeEditModal}
                        onSaved={handleMediaSaved}
                        onDeleted={handleMediaDeleted}
                    />
                )}
            </Show>

            {/* Media View Modal */}
            <Show when={viewingMedia()}>
                {(m,) => <MediaViewerModal media={m()} onClose={closeModal} />}
            </Show>
        </div>
    );
};

export default AdminMedia;
