/**
 * Admin → Gallery: the published media, in order, edited as a DRAFT.
 *
 * Add existing media (library picker, multi-select), stage new files (local
 * preview, uploaded on Publish), remove (optionally deleting the media too),
 * drag to reorder, and edit each item's options in the side panel. Nothing
 * reaches the server until **Publish**: staged files upload to the Media
 * library first, then one `PUT /gallery/admin/items` applies the whole draft.
 *
 * The draft (minus staged files, which a browser cannot keep) is saved to
 * localStorage while dirty and restored on the next visit; leaving is only
 * challenged while files are staged.
 */
import type { GalleryItem, GallerySettings, SubscriptionTierOption, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { createStore, produce, reconcile, unwrap, } from 'solid-js/store';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import GalleryItemPanel, { type GalleryDefaults, } from '../../../components/admin/gallery/GalleryItemPanel';
import {
    buildPublishBody, displayTitle, draftFromItems, EMPTY_OPTIONS, isDraftDirty, mediaFromLibrary, moveItem, persistableDraft,
    type DraftItem, type DraftOptions,
} from '../../../components/admin/gallery/galleryDraft';
import { uploadMediaFile, } from '../../../components/admin/gallery/uploadMedia';
import MediaSelectModal, { type MediaItem, } from '../../../components/admin/media/MediaSelectModal';
import MediaStageModal from '../../../components/admin/media/MediaStageModal';
import { useToast, } from '../../../components/common/toast';
import { useAutoSave, } from '../../../hooks/useAutoSave';
import { useNavigationGuard, } from '../../../hooks/useNavigationGuard';
import { cms, } from '../../../services/cmsClient';
import { isFeatureEnabled, } from '../../../stores/siteSettings';
import '../../../components/admin/media/VideoMedia.scss';
import './GalleryAdmin.scss';

const ACCESS_LABELS = { public: 'Public', members: 'Signed-in members', } as const;
let stageSeq = 0;

const GalleryAdmin: Component = () => {
    const toast = useToast();
    const [settings, setSettings,] = createSignal<GallerySettings | null>(null,);
    const [tiers, setTiers,] = createSignal<SubscriptionTierOption[]>([],);
    const [saved, setSaved,] = createSignal<GalleryItem[]>([],);
    const [draft, setDraft,] = createStore<{ rows: DraftItem[]; }>({ rows: [], },);
    const [loading, setLoading,] = createSignal(true,);
    const [loadError, setLoadError,] = createSignal('',);
    const [ready, setReady,] = createSignal(false,);
    const [selectedKey, setSelectedKey,] = createSignal<string | null>(null,);
    const [picking, setPicking,] = createSignal(false,);
    const [staging, setStaging,] = createSignal(false,);
    const [publishing, setPublishing,] = createSignal(false,);
    /** Upload progress per staged row key during Publish. */
    const [progress, setProgress,] = createStore<Record<string, number>>({},);
    const [revertOpen, setRevertOpen,] = createSignal(false,);
    const [dragFrom, setDragFrom,] = createSignal<number | null>(null,);
    const [dragOver, setDragOver,] = createSignal<number | null>(null,);

    const commentsOn = () => isFeatureEnabled('comments',);
    const rows = () => draft.rows;
    const dirty = createMemo(() => ready() && isDraftDirty(draft.rows, saved(),));
    const stagedCount = () => draft.rows.filter((r,) => r.file && !r.removed,).length;
    const selected = () => draft.rows.find((r,) => r.key === selectedKey(),) ?? null;
    const liveCount = () => draft.rows.filter((r,) => !r.removed,).length;

    const tierName = (id: string | null,) => tiers().find((t,) => t.id === id,)?.name ?? 'Subscribers';
    const galleryDefaults = (): GalleryDefaults => {
        const s = settings();
        const access = s?.access ?? 'public';
        return {
            accessLabel: access === 'tier' ? `${tierName(s?.minTierId ?? null,)} subscribers` : ACCESS_LABELS[access],
            commentsEnabled: Boolean(s?.commentsEnabled,),
            allowAnonymousComments: Boolean(s?.allowAnonymousComments,),
        };
    };
    const visibilityBadge = (r: DraftItem,): string | null => {
        const v = r.options.visibility;
        if (v === 'inherit') return null;
        return v === 'tier' ? tierName(r.options.minTierId,) : v === 'public' ? 'Public' : 'Members';
    };

    // ─── Draft persistence (localStorage) ───
    const autoSave = useAutoSave<DraftItem[]>({
        key: 'gallery-draft',
        state: () => persistableDraft(JSON.parse(JSON.stringify(unwrap(draft.rows,),),),),
        enabled: () => ready() && dirty(),
    },);
    createEffect(() => {
        if (ready() && !dirty() && autoSave.hasDraft()) autoSave.clear();
    },);
    const flushDraft = () => { if (ready() && dirty()) autoSave.flush(); };
    onCleanup(flushDraft,);

    // Leaving is challenged only while files are staged — they cannot be kept.
    const guard = useNavigationGuard({ isDirty: () => stagedCount() > 0 && !publishing(), },);

    const revokePreviews = (list: DraftItem[],) => list.forEach((r,) => { if (r.previewUrl) URL.revokeObjectURL(r.previewUrl,); },);
    onCleanup(() => revokePreviews(draft.rows,),);

    /** Saved items + (if newer) the stored draft. */
    const restoreDraft = (items: GalleryItem[],) => {
        const stored = autoSave.getDraft();
        if (!stored?.data?.length) return false;
        const newest = Math.max(0, ...items.map((i,) => Date.parse(i.updatedAt,) || 0,),);
        if (stored.timestamp <= newest + 1000) {
            autoSave.clear();
            return false;
        }
        const byId = new Map(items.map((i,) => [i.id, i,],),);
        // Drop rows for items deleted elsewhere since; refresh saved rows' media/url/counts.
        const restored = stored.data
            .filter((r,) => !r.id || byId.has(r.id,),)
            .map((r,) => (r.id ? { ...r, media: byId.get(r.id,)!.media, url: byId.get(r.id,)!.url, commentCount: byId.get(r.id,)!.commentCount, } : r));
        const seen = new Set(restored.map((r,) => r.id,).filter(Boolean,),);
        const added = draftFromItems(items.filter((i,) => !seen.has(i.id,),),);
        setDraft('rows', [...restored, ...added,],);
        toast.info('Restored your unpublished gallery changes. Use Discard to drop them.',);
        return true;
    };

    const load = async () => {
        setLoading(true,);
        setLoadError('',);
        try {
            const [s, items, t,] = await Promise.all([
                cms.gallery.settings(),
                cms.gallery.admin.items(),
                cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),
            ],);
            setSettings(s,);
            setTiers(t.filter((x,) => !x.isFree,),);
            setSaved(items,);
            if (!restoreDraft(items,)) setDraft('rows', reconcile(draftFromItems(items,),),);
            setReady(true,);
        } catch (e) {
            setLoadError((e as Error)?.message || 'Could not load the gallery.',);
        } finally {
            setLoading(false,);
        }
    };
    onMount(load,);

    // ─── Draft edits ───
    const patchRow = (key: string, patch: Partial<DraftItem>,) => {
        const i = draft.rows.findIndex((r,) => r.key === key,);
        if (i >= 0) setDraft('rows', i, patch,);
    };
    const patchOptions = (key: string, patch: Partial<DraftOptions>,) => {
        const i = draft.rows.findIndex((r,) => r.key === key,);
        if (i >= 0) setDraft('rows', i, 'options', patch,);
    };

    const usedMediaIds = () => draft.rows.filter((r,) => !r.removed,).map((r,) => r.media?.id ?? r.mediaId,).filter(Boolean,) as string[];

    const addFromLibrary = (list: MediaItem[],) => {
        setPicking(false,);
        let added = 0;
        setDraft('rows', produce((all,) => {
            for (const m of list) {
                // Re-adding media whose item is marked for removal just undoes the removal.
                const removed = all.find((r,) => r.removed && (r.media?.id ?? r.mediaId) === m.id,);
                if (removed) {
                    removed.removed = false;
                    removed.deleteMedia = false;
                    added += 1;
                    continue;
                }
                if (all.some((r,) => (r.media?.id ?? r.mediaId) === m.id,)) continue;
                all.push({ key: `m:${m.id}`, mediaId: m.id, media: mediaFromLibrary(m as never,), options: { ...EMPTY_OPTIONS, tags: [], }, },);
                added += 1;
            }
        },),);
        if (added) toast.info(`${added} item${added > 1 ? 's' : ''} added to the draft. Publish to save.`,);
    };

    const stageFiles = (files: File[],) => {
        setStaging(false,);
        const allowVideos = settings()?.allowVideos !== false;
        const fresh: DraftItem[] = files
            .filter((f,) => allowVideos || !f.type.startsWith('video/',),)
            .map((file,) => ({ key: `f:${++stageSeq}`, file, previewUrl: URL.createObjectURL(file,), media: null, options: { ...EMPTY_OPTIONS, tags: [], }, }));
        if (!fresh.length) return;
        setDraft('rows', (cur,) => [...cur, ...fresh,],);
        toast.info(`${fresh.length} file${fresh.length > 1 ? 's' : ''} staged. They upload when you publish.`,);
    };

    const removeRow = (r: DraftItem,) => {
        if (!r.id) {
            // A new (unsaved) row simply leaves the draft.
            if (r.previewUrl) URL.revokeObjectURL(r.previewUrl,);
            setDraft('rows', (cur,) => cur.filter((x,) => x.key !== r.key,),);
            if (selectedKey() === r.key) setSelectedKey(null,);
            return;
        }
        patchRow(r.key, { removed: true, deleteMedia: false, },);
    };

    const onDrop = (to: number,) => {
        const from = dragFrom();
        setDragFrom(null,);
        setDragOver(null,);
        if (from === null || from === to) return;
        setDraft('rows', moveItem([...draft.rows,], from, to,),);
    };

    const discard = () => {
        setRevertOpen(false,);
        revokePreviews(draft.rows,);
        autoSave.clear();
        setDraft('rows', reconcile(draftFromItems(saved(),),),);
        setSelectedKey(null,);
        toast.info('Discarded the unpublished changes.',);
    };

    // ─── Publish ───
    const publish = async () => {
        if (publishing()) return;
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((r,) => requestAnimationFrame(() => r(null,),),);
        autoSave.cancel();
        setPublishing(true,);
        const uploaded = new Map<string, string>();
        try {
            // 1. Upload staged files, one at a time (each converts to a library row on success,
            //    so a retry after a failure never uploads the same file twice).
            for (const r of draft.rows.filter((x,) => x.file && !x.removed,)) {
                const key = r.key;
                const file = r.file!;
                const mediaId = await uploadMediaFile(file, (p,) => setProgress(key, p,),);
                uploaded.set(key, mediaId,);
                patchRow(key, { mediaId, },);
            }
            // 2. Apply the whole draft.
            const body = buildPublishBody(draft.rows, uploaded,);
            const res = await cms.gallery.admin.publish(body,);
            revokePreviews(draft.rows,);
            setSaved(res.items,);
            setDraft('rows', reconcile(draftFromItems(res.items,),),);
            autoSave.clear();
            setProgress(reconcile({},),);
            if (selectedKey() && !res.items.some((i,) => i.id === selectedKey(),)) setSelectedKey(null,);
            const parts = [
                res.added && `${res.added} added`, res.removed && `${res.removed} removed`, res.mediaDeleted && `${res.mediaDeleted} media deleted`,
            ].filter(Boolean,);
            toast.success(`Gallery published${parts.length ? ` (${parts.join(', ',)})` : ''}.`,);
        } catch (e) {
            // Rows uploaded so far keep their media id (mediaId) — a retry only uploads the rest.
            for (const [key, mediaId,] of uploaded) {
                const i = draft.rows.findIndex((r,) => r.key === key,);
                if (i >= 0) setDraft('rows', i, { file: undefined, mediaId, },);
            }
            toast.error((e as Error)?.message || 'Publishing failed.',);
        } finally {
            setPublishing(false,);
        }
    };

    // Ctrl/Cmd+S publishes.
    const onKey = (e: KeyboardEvent,) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (dirty()) void publish();
        }
    };
    onMount(() => window.addEventListener('keydown', onKey,),);
    onCleanup(() => window.removeEventListener('keydown', onKey,),);

    const thumbOf = (r: DraftItem,) => r.previewUrl ?? r.media?.thumbnailUrl ?? (r.media?.type === 'image' ? r.media.url : null);
    const isVideoRow = (r: DraftItem,) => (r.media?.type === 'video') || Boolean(r.file && (r.file.type.startsWith('video/',) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(r.file.name,)));
    const mediaTypes = () => (settings()?.allowVideos === false ? ['image',] : ['image', 'video',]);

    return (
        <div class="gallery-admin admin-full-bleed">
            <AdminTitle>Gallery</AdminTitle>

            <div class="admin-header">
                <h1>Gallery</h1>
                <div class="admin-header__actions">
                    <Show when={dirty()}>
                        <span class="admin-header__dirty" title="Changes are kept as a draft in this browser until you publish.">
                            Unpublished changes{stagedCount() ? ` · ${stagedCount()} file${stagedCount() > 1 ? 's' : ''} to upload` : ''}
                        </span>
                        <button type="button" class="ui-button ui-button--ghost ui-button--sm" disabled={publishing()} onClick={() => setRevertOpen(true,)}>
                            Discard
                        </button>
                    </Show>
                    <Show when={settings()}>
                        <a class="ui-button ui-button--ghost ui-button--sm" href={settings()!.baseUrl} target="_blank" rel="noopener">View gallery ↗</a>
                    </Show>
                    <A href="/admin/gallery/settings" class="ui-button ui-button--secondary ui-button--sm">Settings</A>
                    <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={!dirty() || publishing()} onClick={() => void publish()}>
                        {publishing() ? 'Publishing…' : 'Publish'}
                    </button>
                </div>
            </div>

            <Show when={!loading()} fallback={<p class="form-help-muted">Loading…</p>}>
                <Show when={!loadError()} fallback={<div class="alert alert--error">{loadError()}</div>}>
                    <div class="gallery-admin__toolbar">
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={publishing()} onClick={() => setPicking(true,)}>
                            + Add from library
                        </button>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={publishing()} onClick={() => setStaging(true,)}>
                            ⬆ Upload new
                        </button>
                        <span class="gallery-admin__count">
                            {liveCount()} item{liveCount() === 1 ? '' : 's'}
                            <Show when={settings()?.allowVideos === false}> · videos are off (Settings)</Show>
                        </span>
                        <span class="gallery-admin__hint">Drag to reorder · click an item for its options</span>
                    </div>

                    <div class="gallery-admin__layout" classList={{ 'has-panel': Boolean(selected(),), }}>
                        <Show
                            when={rows().length}
                            fallback={
                                <div class="empty-state gallery-admin__empty">
                                    <p>The gallery is empty.</p>
                                    <p class="form-help-muted">Add media from the library or upload new files, then publish.</p>
                                </div>
                            }
                        >
                            <div class="media-grid gallery-admin__grid">
                                <For each={rows()}>
                                    {(r, i,) => (
                                        <div
                                            class="media-grid__item gallery-admin__card"
                                            classList={{
                                                'is-selected': selectedKey() === r.key,
                                                'is-removed': Boolean(r.removed,),
                                                'is-new': !r.id,
                                                'is-drag-over': dragOver() === i() && dragFrom() !== i(),
                                                'is-missing': Boolean(r.id && !r.media,),
                                            }}
                                            draggable={!publishing()}
                                            onDragStart={(e,) => { setDragFrom(i(),); e.dataTransfer?.setData('text/plain', r.key,); }}
                                            onDragOver={(e,) => { e.preventDefault(); setDragOver(i(),); }}
                                            onDragEnd={() => { setDragFrom(null,); setDragOver(null,); }}
                                            onDrop={(e,) => { e.preventDefault(); onDrop(i(),); }}
                                            onClick={() => setSelectedKey(selectedKey() === r.key ? null : r.key,)}
                                            role="button"
                                            tabindex="0"
                                            aria-pressed={selectedKey() === r.key}
                                            onKeyDown={(e,) => {
                                                if (e.target !== e.currentTarget) return;
                                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedKey(r.key,); }
                                                if (e.altKey && e.key === 'ArrowLeft' && i() > 0) { e.preventDefault(); setDraft('rows', moveItem([...draft.rows,], i(), i() - 1,),); }
                                                if (e.altKey && e.key === 'ArrowRight' && i() < draft.rows.length - 1) { e.preventDefault(); setDraft('rows', moveItem([...draft.rows,], i(), i() + 1,),); }
                                            }}
                                        >
                                            <div class="media-grid__preview gallery-admin__preview">
                                                <Show
                                                    when={thumbOf(r,)}
                                                    fallback={
                                                        <div class="media-grid__file-icon">
                                                            {r.id && !r.media ? 'Media missing' : isVideoRow(r,) ? '▶ Video' : 'No preview'}
                                                        </div>
                                                    }
                                                >
                                                    {(src,) => (
                                                        <Show when={r.file && isVideoRow(r,)} fallback={<img src={src()} alt={r.media?.alt ?? ''} loading="lazy" />}>
                                                            <video src={src()} muted preload="metadata" />
                                                        </Show>
                                                    )}
                                                </Show>
                                                <div class="gallery-admin__badges">
                                                    <Show when={isVideoRow(r,)}><span class="gallery-admin__badge">Video</span></Show>
                                                    <Show when={visibilityBadge(r,)}>{(v,) => <span class="gallery-admin__badge gallery-admin__badge--vis">{v()}</span>}</Show>
                                                    <Show when={r.file}><span class="gallery-admin__badge gallery-admin__badge--pending">To upload</span></Show>
                                                    <Show when={!r.id && !r.file}><span class="gallery-admin__badge gallery-admin__badge--new">New</span></Show>
                                                </div>
                                                <Show when={publishing() && progress[r.key] !== undefined}>
                                                    <div class="gallery-admin__progress">
                                                        <div class="video-progress"><div class="video-progress__fill" style={{ width: `${progress[r.key]}%`, }} /></div>
                                                        <span>{progress[r.key]}%</span>
                                                    </div>
                                                </Show>
                                            </div>
                                            <div class="media-grid__info">
                                                <div class="media-grid__name" title={displayTitle(r,)}>{displayTitle(r,)}</div>
                                                <div class="media-grid__meta">
                                                    <Show when={r.removed} fallback={<span>{r.id ? `${r.commentCount ?? 0} comment${(r.commentCount ?? 0) === 1 ? '' : 's'}` : 'Not published yet'}</span>}>
                                                        <span>Removed on publish{r.deleteMedia ? ' + media deleted' : ''}</span>
                                                    </Show>
                                                    <Show when={r.options.tags.length}><span>{r.options.tags.join(', ',)}</span></Show>
                                                </div>
                                                <div class="media-grid__actions">
                                                    <Show
                                                        when={r.removed}
                                                        fallback={
                                                            <button
                                                                type="button"
                                                                class="ui-button ui-button--sm ui-button--ghost"
                                                                disabled={publishing()}
                                                                onClick={(e,) => { e.stopPropagation(); removeRow(r,); }}
                                                            >
                                                                Remove
                                                            </button>
                                                        }
                                                    >
                                                        <button
                                                            type="button"
                                                            class="ui-button ui-button--sm ui-button--secondary"
                                                            onClick={(e,) => { e.stopPropagation(); patchRow(r.key, { removed: false, deleteMedia: false, },); }}
                                                        >
                                                            Undo
                                                        </button>
                                                    </Show>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </For>
                            </div>
                        </Show>

                        <Show when={selected()}>
                            {(r,) => (
                                <GalleryItemPanel
                                    item={r()}
                                    defaults={galleryDefaults()}
                                    tiers={tiers()}
                                    commentsOn={commentsOn()}
                                    onChange={(patch,) => patchOptions(r().key, patch,)}
                                    onRemove={() => removeRow(r(),)}
                                    onRestore={() => patchRow(r().key, { removed: false, deleteMedia: false, },)}
                                    onDeleteMediaChange={(v,) => patchRow(r().key, { deleteMedia: v, },)}
                                    onClose={() => setSelectedKey(null,)}
                                />
                            )}
                        </Show>
                    </div>
                </Show>
            </Show>

            <Show when={picking()}>
                <MediaSelectModal
                    multiple
                    title="Add media to the gallery"
                    confirmLabel="Add to gallery"
                    types={mediaTypes()}
                    disabledIds={usedMediaIds()}
                    disabledLabel="In gallery"
                    onSelect={() => {}}
                    onSelectMany={addFromLibrary}
                    onClose={() => setPicking(false,)}
                />
            </Show>
            <Show when={staging()}>
                <MediaStageModal
                    title="Upload new media to the gallery"
                    confirmLabel="Add to gallery"
                    accept={settings()?.allowVideos === false ? 'image/*' : 'image/*,video/*'}
                    onStage={stageFiles}
                    onClose={() => setStaging(false,)}
                />
            </Show>

            <ConfirmModal
                open={revertOpen()}
                title="Discard unpublished changes?"
                message="Every change since the last publish is dropped, including staged files and the stored draft. This cannot be undone."
                confirmLabel="Discard changes"
                danger
                onConfirm={discard}
                onCancel={() => setRevertOpen(false,)}
            />
            <ConfirmModal
                open={guard.pending()}
                title="Files not uploaded yet"
                message="Staged files upload when you publish. Leaving now drops them (the rest of your changes are kept as a draft)."
                confirmLabel="Leave anyway"
                cancelLabel="Stay"
                danger
                onConfirm={() => { flushDraft(); guard.confirmLeave(); }}
                onCancel={guard.cancelLeave}
            />
        </div>
    );
};

export default GalleryAdmin;
