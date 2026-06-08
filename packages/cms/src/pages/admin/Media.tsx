import { Title, } from '@solidjs/meta';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import VideoPlayer from '../../components/blocks/media/VideoPlayer';
import { cms, } from '../../services/cmsClient';

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

function downloadFile(url: string, filename: string,) {
    const a = document.createElement('a',);
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a,);
    a.click();
    document.body.removeChild(a,);
}

const AdminMedia: Component = () => {
    const [typeFilter, setTypeFilter,] = createSignal('',);
    const [searchInput, setSearchInput,] = createSignal('',);
    const [searchQuery, setSearchQuery,] = createSignal('',);
    const [sortBy, setSortBy,] = createSignal('date_desc',);
    const [editingId, setEditingId,] = createSignal<string | null>(null,);
    const [editTitle, setEditTitle,] = createSignal('',);
    const [editDescription, setEditDescription,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [viewingMedia, setViewingMedia,] = createSignal<any>(null,);

    const mediaQuery = () => {
        const q: Record<string, string> = {};
        if (typeFilter()) q.type = typeFilter();
        if (searchQuery()) q.search = searchQuery();
        if (sortBy()) q.sort = sortBy();
        return q;
    };

    const [media, { refetch, },] = createResource(mediaQuery, async (q,) => {
        try {
            const res = await cms.media.list(q as any,);
            return res.data;
        } catch {
            return [];
        }
    },);

    const handleUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        if (input.files?.[0]) {
            await cms.media.upload(input.files[0],);
            input.value = '';
            refetch();
        }
    };

    const startEdit = (item: any, e: Event,) => {
        e.stopPropagation();
        setEditingId(item.id,);
        setEditTitle(item.title || '',);
        setEditDescription(item.caption || '',);
    };

    const cancelEdit = () => {
        setEditingId(null,);
        setEditTitle('',);
        setEditDescription('',);
    };

    const saveEdit = async () => {
        const id = editingId();
        if (!id) return;
        setSaving(true,);
        try {
            await cms.media.update(id, {
                title: editTitle(),
                caption: editDescription(),
            } as any,);
        } finally {
            setSaving(false,);
        }
        setEditingId(null,);
        refetch();
    };

    const handleDelete = async (id: string, e: Event,) => {
        e.stopPropagation();
        if (!confirm('Delete this file permanently?',)) return;
        await cms.media.remove(id,);
        refetch();
    };

    const handleDownload = (m: any, e: Event,) => {
        e.stopPropagation();
        downloadFile(m.url, m.originalName,);
    };

    const openModal = (m: any,) => {
        if (editingId()) return;
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
            <Title>Media - Admin - RW</Title>
            <div class="admin-header">
                <h1>Media Library</h1>
                <label class="btn btn--primary">
                    Upload File
                    <input
                        type="file"
                        onChange={handleUpload}
                        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.zip"
                        style={{ display: 'none', }}
                    />
                </label>
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
                <div class="form-group" style={{ margin: '0', }}>
                    <select value={typeFilter()} onChange={(e,) => setTypeFilter(e.currentTarget.value,)}>
                        <option value="">All Types</option>
                        <option value="image">Images</option>
                        <option value="video">Videos</option>
                        <option value="audio">Audio</option>
                        <option value="document">Documents</option>
                    </select>
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
                when={media()?.length}
                fallback={
                    <div class="empty-state">
                        {media.loading ? 'Loading...' : 'No media found.'}
                    </div>
                }
            >
                <div class="media-grid">
                    <For each={media()}>
                        {(m: any,) => (
                            <div class="media-grid__item" onClick={() => openModal(m,)}>
                                <div class="media-grid__preview">
                                    <Show when={m.mimeType?.startsWith('image/',)}>
                                        <img src={m.thumbnailUrl || m.url} alt={m.alt || m.title || m.originalName} />
                                    </Show>
                                    <Show when={m.mimeType?.startsWith('video/',)}>
                                        <video src={m.url} preload="metadata" muted playsinline />
                                    </Show>
                                    <Show
                                        when={!m.mimeType?.startsWith('image/',) && !m.mimeType?.startsWith('video/',)}
                                    >
                                        <div class="media-grid__file-icon">
                                            <span>{getTypeLabel(m.mimeType,)}</span>
                                        </div>
                                    </Show>
                                </div>

                                <Show
                                    when={editingId() === m.id}
                                    fallback={
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
                                                    class="btn btn--small btn--secondary"
                                                    onClick={(e,) => startEdit(m, e,)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    class="btn btn--small btn--secondary"
                                                    onClick={(e,) => handleDownload(m, e,)}
                                                    title="Download"
                                                >
                                                    &#8595;
                                                </button>
                                                <button
                                                    class="btn btn--small btn--danger"
                                                    onClick={(e,) => handleDelete(m.id, e,)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    }
                                >
                                    <div class="media-grid__edit" onClick={(e,) => e.stopPropagation()}>
                                        <input
                                            type="text"
                                            placeholder="Title"
                                            value={editTitle()}
                                            onInput={(e,) => setEditTitle(e.currentTarget.value,)}
                                        />
                                        <textarea
                                            placeholder="Description"
                                            value={editDescription()}
                                            onInput={(e,) => setEditDescription(e.currentTarget.value,)}
                                            rows={2}
                                        />
                                        <div class="media-grid__edit-actions">
                                            <button
                                                class="btn btn--small btn--primary"
                                                onClick={saveEdit}
                                                disabled={saving()}
                                            >
                                                {saving() ? 'Saving...' : 'Save'}
                                            </button>
                                            <button class="btn btn--small btn--secondary" onClick={cancelEdit}>
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                        )}
                    </For>
                </div>
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
                                    <VideoPlayer
                                        src={m().url}
                                        controls={true}
                                    />
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
                                <button class="btn btn--secondary" onClick={closeModal}>Close</button>
                                <div class="media-modal__meta">
                                    <span>{m().title || m().originalName}</span>
                                    <span class="media-modal__meta-details">
                                        {getTypeLabel(m().mimeType,)} &middot; {formatSize(m().size,)} &middot;{' '}
                                        {new Date(m().createdAt,).toLocaleDateString()}
                                    </span>
                                </div>
                                <button class="btn btn--primary" onClick={(e,) => handleDownload(m(), e,)}>
                                    Download
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default AdminMedia;
