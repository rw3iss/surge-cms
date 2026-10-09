import { A, } from '@solidjs/router';
import type { Media, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import VideoPlayer from '../../components/blocks/media/VideoPlayer';
import MediaVideo from '../../components/blocks/media/MediaVideo';
import MediaEditModal from '../../components/admin/media/MediaEditModal';
import RenditionChips from '../../components/admin/media/RenditionChips';
import { formatDuration, } from '../../components/admin/media/videoFormat';
import { cms, } from '../../services/cmsClient';
import { startUpload, uploadsVersion, usesMultipart, } from '../../stores/uploads';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import AdminTitle from '../../components/admin/common/AdminTitle';
import '../../components/admin/media/VideoMedia.scss';

function formatSize(bytes: number,): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1,)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1,)} MB`;
}

function getTypeLabel(mimeType: string,): string {
    if (mimeType.startsWith('image/',)) return 'Image';
    if (mimeType.startsWith('video/',)) return 'Video';
    if (mimeType.startsWith('audio/',)) return 'Audio';
    return 'Document';
}

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
const VideoTile: Component<{ m: Media; }> = (p,) => {
    const poster = () => p.m.video?.posterUrl ?? p.m.thumbnailUrl ?? null;
    return (
        <div class="media-video-tile">
            <Show when={poster()} fallback={<div class="media-video-tile__placeholder" aria-hidden="true">&#9654;</div>}>
                <img class="media-video-tile__poster" src={poster()!} alt={p.m.alt || p.m.originalName} loading="lazy" />
            </Show>
            <div class="media-video-tile__badges">
                <Show when={p.m.accessLevel === 'private'}>
                    <span class="media-video-tile__badge" title="Private — full video for subscribers only">&#128274; Private</span>
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

function downloadFile(url: string, filename: string,) {
    const a = document.createElement('a',);
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a,);
    a.click();
    document.body.removeChild(a,);
}

type MediaKind = 'image' | 'video' | 'audio' | 'document';

/** Type filter buttons (the API's `types` list; `document` = anything else). */
const MEDIA_KINDS: { key: MediaKind; label: string; icon: string; }[] = [
    { key: 'image', label: 'Images', icon: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01', },
    { key: 'video', label: 'Videos', icon: 'M4 6h12v12H4zM16 10l4-2.5v9L16 14', },
    { key: 'audio', label: 'Audio', icon: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', },
    { key: 'document', label: 'Documents', icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', },
];

const AdminMedia: Component = () => {
    // Type filter: any combination of types; none selected = All.
    const [types, setTypes,] = createSignal<MediaKind[]>([],);
    const toggleType = (k: MediaKind,) =>
        setTypes((cur,) => (cur.includes(k,) ? cur.filter((x,) => x !== k) : [...cur, k,]));
    const [searchInput, setSearchInput,] = createSignal('',);
    const [searchQuery, setSearchQuery,] = createSignal('',);
    const [sortBy, setSortBy,] = createSignal('date_desc',);
    const [editingMedia, setEditingMedia,] = createSignal<any>(null,);
    const [viewingMedia, setViewingMedia,] = createSignal<any>(null,);

    const mediaQuery = () => {
        const q: Record<string, string> = {};
        if (types().length) q.types = types().join(',',);
        if (searchQuery()) q.search = searchQuery();
        if (sortBy()) q.sort = sortBy();
        return q;
    };

    const [media, { refetch, },] = createResource(mediaQuery, async (q,) => {
        try {
            const res = await cms.media.list(q as any,);
            return res.data as Media[];
        } catch {
            return [] as Media[];
        }
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

    const handleUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        input.value = '';
        if (usesMultipart(file,)) {
            // Straight to storage; the upload tray shows progress and the list
            // refetches when it completes.
            startUpload(file,);
            return;
        }
        await cms.media.upload(file,);
        refetch();
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

    const handleDelete = async (id: string, e: Event,) => {
        e.stopPropagation();
        if (!confirm('Delete this file permanently?',)) return;
        await cms.media.remove(id,);
        refetch();
    };

    /** URL just copied from the view modal — flips its button to "Copied" briefly. */
    const [copiedUrl, setCopiedUrl,] = createSignal<string | null>(null,);
    const copyUrl = (url: string,) => {
        void navigator.clipboard.writeText(url,).then(() => {
            setCopiedUrl(url,);
            setTimeout(() => setCopiedUrl((u,) => (u === url ? null : u)), 1500,);
        },).catch(() => window.prompt('Copy this URL:', url,));
    };

    /** A 7-day link to the plain video file that skips the access check. */
    const copyShareLink = async (id: string,) => {
        try {
            const { url, } = await cms.media.video.share(id, 7,);
            await navigator.clipboard.writeText(url,).catch(() => window.prompt('Copy this share link:', url,));
            const key = `share:${id}`;
            setCopiedUrl(key,);
            setTimeout(() => setCopiedUrl((u,) => (u === key ? null : u)), 2000,);
        } catch (e) {
            window.alert(`Could not create a share link: ${(e as Error).message}`,);
        }
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

    const handleModalContentClick = (m: any,) => {
        // For images and documents, open in new tab
        // Videos are handled by Plyr's built-in controls
        if (
            m.mimeType?.startsWith('image/',) ||
            (!m.mimeType?.startsWith('video/',) && !m.mimeType?.startsWith('audio/',))
        ) {
            window.open(m.url, '_blank',);
        }
    };

    const handleBackdropClick = (e: Event,) => {
        if ((e.target as HTMLElement).classList.contains('media-modal',)) {
            closeModal();
        }
    };

    let searchTimeout: ReturnType<typeof setTimeout>;
    const handleSearchInput = (value: string,) => {
        setSearchInput(value,);
        clearTimeout(searchTimeout,);
        searchTimeout = setTimeout(() => setSearchQuery(value,), 300,);
    };

    const clearSearch = () => {
        setSearchInput('',);
        setSearchQuery('',);
    };

    return (
        <div>
            <AdminTitle>Media</AdminTitle>
            <div class="admin-header">
                <h1>Media Library</h1>
                <div class="admin-header__actions">
                <A href="/admin/media/settings" class="ui-button ui-button--secondary">Settings</A>
                <label class="ui-button ui-button--primary">
                    Upload File
                    <input
                        type="file"
                        onChange={handleUpload}
                        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.zip"
                        style={{ display: 'none', }}
                    />
                </label>
                </div>
            </div>

            <div
                class="media-filters"
                style={{
                    display: 'flex',
                    gap: '0.75rem',
                    'margin-bottom': '1.5rem',
                    'flex-wrap': 'wrap',
                    'align-items': 'center',
                }}
            >
                <div class="media-type-filter" role="group" aria-label="Media types">
                    <button
                        type="button"
                        class="media-type-filter__btn"
                        classList={{ 'is-active': types().length === 0, }}
                        aria-pressed={types().length === 0}
                        onClick={() => setTypes([],)}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>
                        All
                    </button>
                    <For each={MEDIA_KINDS}>
                        {(k,) => (
                            <button
                                type="button"
                                class="media-type-filter__btn"
                                classList={{ 'is-active': types().includes(k.key,), }}
                                aria-pressed={types().includes(k.key,)}
                                onClick={() => toggleType(k.key,)}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={k.icon} /></svg>
                                {k.label}
                            </button>
                        )}
                    </For>
                </div>
                <div class="form-group" style={{ margin: '0', flex: '1', 'min-width': '200px', position: 'relative', }}>
                    <input
                        type="text"
                        placeholder="Search by title or description..."
                        value={searchInput()}
                        onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                        style={{ 'padding-right': '2rem', }}
                    />
                    <Show when={searchInput()}>
                        <button
                            type="button"
                            onClick={clearSearch}
                            style={{
                                position: 'absolute',
                                right: '8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px 6px',
                                'font-size': '1.1rem',
                                color: '#94a3b8',
                                'line-height': '1',
                            }}
                            title="Clear search"
                        >
                            &times;
                        </button>
                    </Show>
                </div>
                <div class="form-group" style={{ margin: '0', }}>
                    <select value={sortBy()} onChange={(e,) => setSortBy(e.currentTarget.value,)}>
                        <option value="date_desc">Newest First</option>
                        <option value="date_asc">Oldest First</option>
                        <option value="title_asc">Title A-Z</option>
                        <option value="title_desc">Title Z-A</option>
                        <option value="size_desc">Largest First</option>
                        <option value="size_asc">Smallest First</option>
                    </select>
                </div>
            </div>

            <Show
                when={media.latest?.length}
                fallback={
                    <div class="empty-state">
                        {media.loading ? 'Loading...' : 'No media found.'}
                    </div>
                }
            >
                <div class="media-grid">
                    <For each={media.latest}>
                        {(m: any,) => (
                            <div class="media-grid__item" onClick={() => openModal(m,)}>
                                <div class="media-grid__preview">
                                    <Show when={m.mimeType?.startsWith('image/',)}>
                                        <img src={m.thumbnailUrl || m.url} alt={m.alt || m.title || m.originalName} />
                                    </Show>
                                    <Show when={m.mimeType?.startsWith('video/',)}>
                                        <Show
                                            when={isEncodedVideo(m,)}
                                            fallback={<video src={m.url} preload="metadata" muted playsinline />}
                                        >
                                            <VideoTile m={m} />
                                        </Show>
                                    </Show>
                                    <Show
                                        when={!m.mimeType?.startsWith('image/',) && !m.mimeType?.startsWith('video/',)}
                                    >
                                        <div class="media-grid__file-icon">
                                            <span>{getTypeLabel(m.mimeType,)}</span>
                                        </div>
                                    </Show>
                                </div>

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
                                    <div class="media-grid__actions">
                                        <button
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            onClick={(e,) => startEdit(m, e,)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            class="ui-button ui-button--sm ui-button--secondary"
                                            onClick={(e,) => handleDownload(m, e,)}
                                            title="Download"
                                        >
                                            &#8595;
                                        </button>
                                        <button
                                            class="ui-button ui-button--sm ui-button--danger"
                                            onClick={(e,) => handleDelete(m.id, e,)}
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
                {(m,) => (
                    <div class="media-modal" onClick={handleBackdropClick}>
                        <div class="media-modal__container">
                            <button class="media-modal__close-icon" onClick={closeModal} title="Close">
                                &times;
                            </button>

                            <div class="media-modal__content" onClick={() => handleModalContentClick(m(),)}>
                                <Show when={m().mimeType?.startsWith('image/',)}>
                                    <img src={m().url} alt={m().alt || m().title || m().originalName} />
                                </Show>
                                <Show when={m().mimeType?.startsWith('video/',)}>
                                    <Show
                                        when={isEncodedVideo(m(),)}
                                        fallback={<VideoPlayer src={m().url} controls={true} />}
                                    >
                                        <MediaVideo mediaId={m().id} showVariantSwitch showQualityMenu />
                                    </Show>
                                </Show>
                                <Show when={m().mimeType?.startsWith('audio/',)}>
                                    <div class="media-modal__audio">
                                        <div class="media-modal__audio-icon">&#9835;</div>
                                        <audio src={m().url} controls preload="metadata" />
                                    </div>
                                </Show>
                                <Show
                                    when={!m().mimeType?.startsWith('image/',) &&
                                        !m().mimeType?.startsWith('video/',) && !m().mimeType?.startsWith('audio/',)}
                                >
                                    <div class="media-modal__file">
                                        <div class="media-modal__file-icon">{getTypeLabel(m().mimeType,)}</div>
                                        <div class="media-modal__file-name">{m().originalName}</div>
                                        <div class="media-modal__file-hint">Click to open in new tab</div>
                                    </div>
                                </Show>
                            </div>

                            <div class="media-modal__footer">
                                <button class="ui-button ui-button--secondary" onClick={closeModal}>Close</button>
                                <div class="media-modal__meta">
                                    <span>{m().title || m().originalName}</span>
                                    <span class="media-modal__meta-details">
                                        {getTypeLabel(m().mimeType,)} &middot; {formatSize(m().size,)} &middot;{' '}
                                        {new Date(m().createdAt,).toLocaleDateString()}
                                    </span>
                                </div>
                                <div class="media-modal__actions">
                                    <button
                                        class="ui-button ui-button--secondary"
                                        title={m().video ? 'Direct link: plays the video file for anyone allowed to watch it' : undefined}
                                        onClick={() => copyUrl(m().url,)}
                                    >
                                        {copiedUrl() === m().url ? 'Copied' : 'Copy URL'}
                                    </button>
                                    <Show when={m().video}>
                                        <button
                                            class="ui-button ui-button--secondary"
                                            title="A 7-day link that plays the file for anyone, signed in or not"
                                            onClick={() => void copyShareLink(m().id,)}
                                        >
                                            {copiedUrl() === `share:${m().id}` ? 'Copied (7 days)' : 'Copy share link'}
                                        </button>
                                    </Show>
                                    <button class="ui-button ui-button--primary" onClick={(e,) => handleDownload(m(), e,)}>
                                        Download
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default AdminMedia;
