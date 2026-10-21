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
 *
 * COLLECTIONS (one level of folders) are NOT part of the draft: creating,
 * editing and deleting one saves at once, and so does moving a PUBLISHED item
 * between collections (`moveItems`) — the saved items and the draft rows are
 * both updated, so the move never reads as an unpublished change. A NEW row
 * moves inside the draft (its `collectionId` is sent on Publish). The open
 * collection lives in the URL (`?collection=<id>`); the root view shows the
 * folder tiles, then the items in no collection.
 */
import type {
    GalleryCollection, GalleryCollectionInput, GalleryItem, GallerySettings, RoleDef, SubscriptionTierOption,
} from '@sitesurge/types';
import { isGalleryAccessRuleActive, } from '@sitesurge/types';
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, } from 'solid-js';
import { createStore, produce, reconcile, } from 'solid-js/store';
import AdminTitle from '../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../components/admin/common/ConfirmModal';
import CollectionPanel from '../../../components/admin/gallery/CollectionPanel';
import DeleteCollectionModal, { type DeleteCollectionChoice, } from '../../../components/admin/gallery/DeleteCollectionModal';
import GalleryItemPanel, { type GalleryDefaults, } from '../../../components/admin/gallery/GalleryItemPanel';
import {
    basedOnOf, buildPublishBody, displayTitle, draftFromItems, emptyOptions, inheritedOverride, isDraftDirty, mediaFromLibrary, moveItem, persistableDraft, rowsIn,
    type DraftItem, type DraftOptions,
} from '../../../components/admin/gallery/galleryDraft';
import { bulkPatches, filterRows, type BulkAction, type GalleryTypeFilter, } from '../../../components/admin/gallery/galleryBulk';
import { uploadStaged, } from '../../../components/admin/gallery/publishGallery';
import { UploadCancelledError, uploadMediaFile, } from '../../../components/admin/gallery/uploadMedia';
import MediaSearchInput from '../../../components/admin/media/MediaSearchInput';
import Checkbox from '../../../components/ui/Checkbox';
import MediaSelectModal, { type MediaItem, } from '../../../components/admin/media/MediaSelectModal';
import MediaStageModal, { type StagedFile, } from '../../../components/admin/media/MediaStageModal';
import { cancelMedia, defaultTitle, } from '../../../stores/uploads';
import { confirmMediaDelete, } from '../../../stores/mediaDeleteConfirm';
import { useToast, } from '../../../components/common/toast';
import type { MultiSelectOption, } from '../../../components/ui/MultiSelect';
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
    /** Abort handles of staged uploads during Publish (by row key). */
    const uploadAborts = new Map<string, AbortController>();
    /** Row keys whose Cancel is running (discarding a processing video). */
    const [cancelling, setCancelling,] = createStore<Record<string, boolean>>({},);
    const [revertOpen, setRevertOpen,] = createSignal(false,);
    /** Dragged row key; the hovered drop target: a row key, `c:<collectionId>` or `back`. */
    const [dragFrom, setDragFrom,] = createSignal<string | null>(null,);
    const [dragOver, setDragOver,] = createSignal<string | null>(null,);
    const [collections, setCollections,] = createSignal<GalleryCollection[]>([],);
    const [roleOptions, setRoleOptions,] = createSignal<MultiSelectOption[]>([],);
    const [tierOptions, setTierOptions,] = createSignal<MultiSelectOption[]>([],);
    const [selectedCollectionId, setSelectedCollectionId,] = createSignal<string | null>(null,);
    const [creatingCollection, setCreatingCollection,] = createSignal(false,);
    const [deleteTarget, setDeleteTarget,] = createSignal<GalleryCollection | null>(null,);
    const [deletingCollection, setDeletingCollection,] = createSignal(false,);
    const [searchParams, setSearchParams,] = useSearchParams<{ collection?: string; }>();

    const commentsOn = () => isFeatureEnabled('comments',);
    const dirty = createMemo(() => ready() && isDraftDirty(draft.rows, saved(),));
    const stagedCount = () => draft.rows.filter((r,) => r.file && !r.removed,).length;
    const selected = () => draft.rows.find((r,) => r.key === selectedKey(),) ?? null;

    // ─── Collections / current view ───
    /** The open collection (null = the gallery root); an unknown id falls back to the root. */
    const openCollection = () => collections().find((c,) => c.id === searchParams.collection,) ?? null;
    const openId = () => openCollection()?.id ?? null;
    const viewRows = createMemo(() => rowsIn(draft.rows, openId(),),);
    const liveCount = () => viewRows().filter((r,) => !r.removed,).length;

    // ─── Filter + bulk selection (F2) — every bulk action is a draft edit ───
    const [filterText, setFilterText,] = createSignal('',);
    const [filterType, setFilterType,] = createSignal<GalleryTypeFilter>('all',);
    const filtering = () => Boolean(filterText().trim(),) || filterType() !== 'all';
    const shownRows = createMemo(() => (filtering() ? filterRows(viewRows(), filterText(), filterType(),) : viewRows()),);
    const [bulkMode, setBulkMode,] = createSignal(false,);
    const [picked, setPicked,] = createSignal<Set<string>>(new Set<string>(),);
    const togglePicked = (key: string, on?: boolean,) => {
        const next = new Set(picked(),);
        if (on ?? !next.has(key,)) next.add(key,);
        else next.delete(key,);
        setPicked(next,);
    };
    const allShownPicked = () => shownRows().length > 0 && shownRows().every((r,) => picked().has(r.key,),);
    const endBulk = () => { setBulkMode(false,); setPicked(new Set<string>(),); };
    const [bulkTag, setBulkTag,] = createSignal('',);
    const applyBulk = (action: BulkAction,) => {
        const { patches, drop, } = bulkPatches(draft.rows, picked(), action,);
        for (const [key, patch,] of patches) patchRow(key, patch,);
        if (drop.length) {
            const gone = new Set(drop,);
            revokePreviews(draft.rows.filter((r,) => gone.has(r.key,),),);
            setDraft('rows', (cur,) => cur.filter((r,) => !gone.has(r.key,),),);
        }
        const n = patches.size + drop.length;
        toast.info(n ? `${n} item${n === 1 ? '' : 's'} changed — saved when you publish.` : 'Nothing to change.',);
        if (action.kind === 'move' || action.kind === 'remove') setPicked(new Set<string>(),);
    };
    const selectedCollection = () => collections().find((c,) => c.id === selectedCollectionId(),) ?? null;
    const collectionCount = (id: string,) => draft.rows.filter((r,) => !r.removed && r.collectionId === id,).length;
    const collectionCover = (c: GalleryCollection,) => {
        const first = draft.rows.find((r,) => !r.removed && r.collectionId === c.id && thumbOf(r,) && !(r.file && isVideoRow(r,)),);
        return (first && thumbOf(first,)) || c.coverThumbnailUrl;
    };
    const selectItem = (key: string | null,) => { setSelectedKey(key,); if (key) setSelectedCollectionId(null,); };
    const selectCollection = (id: string | null,) => { setSelectedCollectionId(id,); if (id) setSelectedKey(null,); };
    const goTo = (id: string | null,) => {
        setSearchParams({ collection: id ?? undefined, },);
        // An item selected in the view being left would leave the panel showing a hidden item.
        const r = selected();
        if (r && (r.collectionId ?? null) !== id) setSelectedKey(null,);
    };
    const fullIndex = (key: string,) => draft.rows.findIndex((r,) => r.key === key,);

    const tierName = (id: string | null,) => tiers().find((t,) => t.id === id,)?.name ?? 'Members';
    const galleryDefaults = (): GalleryDefaults => {
        const s = settings();
        const access = s?.access ?? 'public';
        return {
            accessLabel: access === 'tier' ? `${tierName(s?.minTierId ?? null,)} members` : ACCESS_LABELS[access],
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
        // Stringify the store PROXY (not unwrap) so every row field is tracked and edits trigger a save.
        state: () => persistableDraft(JSON.parse(JSON.stringify(draft.rows,),),),
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
            .map((r,) => {
                if (!r.id) return r;
                const s = byId.get(r.id,)!;
                // Moves are drafted: keep the draft's collection while it still exists, else the server's.
                const drafted = r.collectionId ?? null;
                const collectionId = drafted === null || collections().some((c,) => c.id === drafted,) ? drafted : (s.collectionId ?? null);
                return { ...r, collectionId, media: s.media, url: s.url, commentCount: s.commentCount, };
            },);
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
            // One tier fetch (P5): the staff-safe options carry everything both pickers need.
            const [s, items, t, cols, roleList,] = await Promise.all([
                cms.gallery.settings(),
                cms.gallery.admin.items(),
                cms.subscriptionTiers.options().catch(() => [] as SubscriptionTierOption[]),
                cms.gallery.adminCollections().catch(() => [] as GalleryCollection[]),
                cms.roles.list().catch(() => [] as RoleDef[]),
            ],);
            const tierList = t;
            setSettings(s,);
            setTiers(t.filter((x,) => !x.isFree,),);
            setCollections(cols,);
            // Anonymous can never pass a restriction, so it is not offered.
            setRoleOptions(roleList.filter((r,) => r.key !== 'anonymous',).map((r,) => ({ value: r.key, label: r.label || r.key, hint: r.key, })),);
            setTierOptions(tierList.map((x,) => ({ value: x.id, label: x.name, hint: x.isActive ? (x.isFree ? 'Free' : undefined) : 'Inactive', })),);
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
                all.push({ key: `m:${m.id}`, mediaId: m.id, collectionId: openId(), media: mediaFromLibrary(m as never,), options: emptyOptions(), },);
                added += 1;
            }
        },),);
        if (added) toast.info(`${added} item${added > 1 ? 's' : ''} added to the draft. Publish to save.`,);
    };

    const stageFiles = (files: StagedFile[],) => {
        setStaging(false,);
        const allowVideos = settings()?.allowVideos !== false;
        const fresh: DraftItem[] = files
            .filter(({ file: f, },) => allowVideos || !f.type.startsWith('video/',),)
            .map(({ file, title, },) => ({
                key: `f:${++stageSeq}`, file, uploadTitle: title, previewUrl: URL.createObjectURL(file,), collectionId: openId(), media: null,
                options: emptyOptions(),
            }));
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

    /** A staged file waiting for / in its upload during Publish. */
    const isUploadingRow = (r: DraftItem,) => publishing() && Boolean(r.file,) && !r.removed;
    /** The row's media is a video still being encoded. */
    const isProcessingRow = (r: DraftItem,) => r.media?.status === 'processing' && !r.file;

    /**
     * Cancel a row's upload or encode. Uploading (Publish running): aborts the
     * upload and drops the row from the draft. Processing: confirms, then
     * discards the media on the server (encode stopped, files, media row and
     * the gallery item deleted) and drops the row.
     */
    const cancelRow = async (r: DraftItem,) => {
        if (isUploadingRow(r,)) {
            uploadAborts.get(r.key,)?.abort();
            removeRow(r,);
            setProgress(r.key, undefined!,);
            return;
        }
        const mediaId = r.media?.id ?? r.mediaId;
        if (!mediaId) return;
        const ok = await confirmMediaDelete({
            ids: [mediaId,], title: 'Stop processing?', confirmLabel: 'Stop and delete',
            message: `Stop processing "${displayTitle(r,)}" and delete it? The media and its gallery item are deleted.`,
            ignoreKinds: ['gallery_item',],
        },);
        if (!ok.confirmed) return;
        setCancelling(r.key, true,);
        try {
            await cancelMedia(mediaId, { force: ok.force, },);
            setDraft('rows', (cur,) => cur.filter((x,) => x.key !== r.key,),);
            if (r.id) setSaved((cur,) => cur.filter((i,) => i.id !== r.id,),);
            if (selectedKey() === r.key) setSelectedKey(null,);
            toast.success('Cancelled and deleted.',);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not cancel.',);
        } finally {
            setCancelling(r.key, false,);
        }
    };

    const endDrag = () => { setDragFrom(null,); setDragOver(null,); };

    /** Reorder: the dragged row takes the dropped-on row's place (indices in the FULL list). */
    const onDrop = (toKey: string,) => {
        const fromKey = dragFrom();
        endDrag();
        if (!fromKey || fromKey === toKey) return;
        const from = fullIndex(fromKey,);
        const to = fullIndex(toKey,);
        if (from < 0 || to < 0) return;
        setDraft('rows', moveItem([...draft.rows,], from, to,),);
    };

    /** Alt+←/→ swaps with the neighbour IN THE VIEW (rows of other collections sit between them in the full list). */
    const nudge = (key: string, dir: -1 | 1,) => {
        const view = viewRows();
        const vi = view.findIndex((r,) => r.key === key,);
        const neighbour = view[vi + dir];
        if (vi < 0 || !neighbour) return;
        setDraft('rows', moveItem([...draft.rows,], fullIndex(key,), fullIndex(neighbour.key,),),);
    };

    /**
     * Move a row into a collection (null = the root). DRAFTED like every other
     * item edit (C5) — published with the rest, undone by Discard. Collection
     * create / rename / delete stay immediate (the collection panel says so).
     */
    const moveRow = (key: string, collectionId: string | null,) => {
        const r = draft.rows.find((x,) => x.key === key,);
        if (!r || (r.collectionId ?? null) === collectionId) return;
        const where = collectionId ? `"${collections().find((c,) => c.id === collectionId,)?.name ?? 'collection'}"` : 'the gallery root';
        patchRow(key, { collectionId, },);
        toast.info(`Moved to ${where} — saved when you publish.`,);
        if (selectedKey() === key && collectionId !== openId()) setSelectedKey(null,);
    };

    const dropOnFolder = (collectionId: string | null,) => {
        const key = dragFrom();
        endDrag();
        if (key) moveRow(key, collectionId,);
    };

    // ─── Collections (saved at once, not drafted) ───
    const newCollection = async () => {
        if (creatingCollection()) return;
        setCreatingCollection(true,);
        try {
            const c = await cms.gallery.createCollection({},);
            // The server places a new collection FIRST.
            setCollections((cur,) => [c, ...cur.filter((x,) => x.id !== c.id,),],);
            selectCollection(c.id,);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not create the collection.',);
        } finally {
            setCreatingCollection(false,);
        }
    };

    const saveCollection = async (id: string, input: GalleryCollectionInput,) => {
        try {
            const c = await cms.gallery.updateCollection(id, input,);
            setCollections((cur,) => cur.map((x,) => (x.id === id ? c : x)),);
            toast.success('Collection saved.',);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not save the collection.',);
        }
    };

    const deleteCollection = async (choice: DeleteCollectionChoice,) => {
        const c = deleteTarget();
        if (!c || deletingCollection()) return;
        let forceMedia = false;
        if (choice.items === 'delete' && choice.deleteMedia) {
            // The collection's items go with it, so only OTHER uses count.
            const ids = saved().filter((i,) => i.collectionId === c.id,).map((i,) => i.media?.id ?? i.mediaId ?? '',).filter(Boolean,);
            if (ids.length) {
                const ok = await confirmMediaDelete({
                    ids, title: 'Delete the collection\'s media?', confirmLabel: 'Delete',
                    message: `${ids.length} media file${ids.length > 1 ? 's' : ''} will be deleted from the library.`,
                    ignoreKinds: ['gallery_item',],
                },);
                if (!ok.confirmed) return;
                forceMedia = ok.force;
            }
        }
        setDeletingCollection(true,);
        try {
            const res = await cms.gallery.deleteCollection(c.id, { ...choice, forceMedia, },);
            if (res.mediaKept) toast.info(`${res.mediaKept} media file${res.mediaKept > 1 ? 's were' : ' was'} kept — still used elsewhere.`,);
            const items = await cms.gallery.admin.items();
            const byId = new Map(items.map((i,) => [i.id, i,],),);
            const dest = choice.items === 'move' ? choice.targetId ?? null : null;
            // Saved rows follow the server; NEW rows in the collection get the same treatment locally.
            const dropped: DraftItem[] = [];
            setDraft('rows', produce((all,) => {
                for (let i = all.length - 1; i >= 0; i--) {
                    const r = all[i];
                    if (r.id) {
                        const s = byId.get(r.id,);
                        // Rows drafted into the deleted collection follow the server; other drafted moves stay.
                        if (!s) { dropped.push(r,); all.splice(i, 1,); } else if ((r.collectionId ?? null) === c.id) r.collectionId = s.collectionId ?? null;
                    } else if (r.collectionId === c.id) {
                        if (choice.items === 'delete') { dropped.push(r,); all.splice(i, 1,); } else r.collectionId = dest;
                    }
                }
            },),);
            revokePreviews(dropped,);
            setSaved(items,);
            setCollections((cur,) => cur.filter((x,) => x.id !== c.id,),);
            if (selectedKey() && !draft.rows.some((r,) => r.key === selectedKey(),)) setSelectedKey(null,);
            if (selectedCollectionId() === c.id) setSelectedCollectionId(null,);
            if (searchParams.collection === c.id) goTo(null,);
            setDeleteTarget(null,);
            toast.success(`Deleted "${c.name}".`,);
        } catch (e) {
            toast.error((e as Error)?.message || 'Could not delete the collection.',);
        } finally {
            setDeletingCollection(false,);
        }
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
    const publish = async (opts: { overwrite?: boolean; } = {},) => {
        if (publishing()) return;
        // Removals that also delete their media: say where that media is still used.
        const mediaToDelete = draft.rows
            .filter((r,) => r.removed && r.id && r.deleteMedia,)
            .map((r,) => r.media?.id ?? r.mediaId ?? '',)
            .filter(Boolean,);
        let forceMedia = false;
        if (mediaToDelete.length) {
            const ok = await confirmMediaDelete({
                ids: mediaToDelete, title: 'Publish and delete media?', confirmLabel: 'Publish',
                message: `${mediaToDelete.length} media file${mediaToDelete.length > 1 ? 's' : ''} will be deleted from the library with the removed item${mediaToDelete.length > 1 ? 's' : ''}.`,
                // The removed items go in the same publish.
                ignoreKinds: ['gallery_item',],
            },);
            if (!ok.confirmed) return;
            forceMedia = ok.force;
        }
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((r,) => requestAnimationFrame(() => r(null,),),);
        autoSave.cancel();
        setPublishing(true,);
        let uploaded = new Map<string, string>();
        try {
            // 1. Upload staged files, one at a time (each converts to a library row on success,
            //    so a retry after a failure never uploads the same file twice) — `uploadStaged`.
            uploaded = await uploadStaged({
                rows: () => draft.rows,
                upload: async (r,) => {
                    const key = r.key;
                    const file = r.file!;
                    const rowTitle = () => {
                        const row = draft.rows.find((x,) => x.key === key,);
                        return row?.uploadTitle?.trim() || defaultTitle(file.name,);
                    };
                    const ac = new AbortController();
                    uploadAborts.set(key, ac,);
                    try {
                        return await uploadMediaFile(file, {
                            title: rowTitle(), getTitle: rowTitle, signal: ac.signal, onProgress: (p,) => setProgress(key, p,),
                        },);
                    } finally {
                        uploadAborts.delete(key,);
                    }
                },
                isCancelled: (e,) => e instanceof UploadCancelledError,
                onUploaded: (key, mediaId,) => {
                    patchRow(key, { mediaId, },);
                    // The item inherits the media title; an identical override is dropped.
                    const row = draft.rows.find((x,) => x.key === key,);
                    const title = row?.uploadTitle?.trim() || defaultTitle(row?.file?.name ?? '',);
                    if (row) patchOptions(key, { titleOverride: inheritedOverride(row.options, title,), },);
                },
            },).catch((e: Error & { uploaded?: Map<string, string>; },) => {
                if (e.uploaded) uploaded = e.uploaded;
                throw e;
            },);
            // 2. Apply the whole draft — refused (409 GALLERY_CHANGED) when the
            //    gallery changed since it was loaded, unless "Publish anyway".
            const body = buildPublishBody(draft.rows, uploaded,);
            if (forceMedia) body.forceMedia = true;
            body.basedOn = basedOnOf(saved(),);
            if (opts.overwrite) body.overwrite = true;
            const res = await cms.gallery.admin.publish(body,);
            revokePreviews(draft.rows,);
            setSaved(res.items,);
            setDraft('rows', reconcile(draftFromItems(res.items,),),);
            autoSave.clear();
            setProgress(reconcile({},),);
            if (selectedKey() && !res.items.some((i,) => i.id === selectedKey(),)) setSelectedKey(null,);
            const parts = [
                res.added && `${res.added} added`, res.removed && `${res.removed} removed`, res.mediaDeleted && `${res.mediaDeleted} media deleted`,
                res.mediaKept && `${res.mediaKept} media kept — still used elsewhere`,
            ].filter(Boolean,);
            toast.success(`Gallery published${parts.length ? ` (${parts.join(', ',)})` : ''}.`,);
        } catch (e) {
            // Rows uploaded so far keep their media id (mediaId) — a retry only uploads the rest.
            for (const [key, mediaId,] of uploaded) {
                const i = draft.rows.findIndex((r,) => r.key === key,);
                if (i >= 0) setDraft('rows', i, { file: undefined, mediaId, },);
            }
            if ((e as { code?: string; })?.code === 'GALLERY_CHANGED') setConflictOpen(true,);
            else toast.error((e as Error)?.message || 'Publishing failed.',);
        } finally {
            setPublishing(false,);
        }
    };

    // ─── Publish conflict (C4) ───
    const [conflictOpen, setConflictOpen,] = createSignal(false,);
    /** Reload the gallery as it is now; this draft is dropped (the other editor's work wins). */
    const reloadAfterConflict = async () => {
        setConflictOpen(false,);
        revokePreviews(draft.rows,);
        autoSave.clear();
        setSelectedKey(null,);
        await load();
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
                <Show when={openCollection()} fallback={<h1>Gallery</h1>}>
                    {(c,) => (
                        <h1 class="gallery-admin__crumbs">
                            <button type="button" class="gallery-admin__crumb" onClick={() => goTo(null,)}>Gallery</button>
                            <span class="gallery-admin__crumb-sep" aria-hidden="true">/</span>
                            <span>{c().name}</span>
                        </h1>
                    )}
                </Show>
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
                        <Show when={!openCollection()}>
                            <button
                                type="button"
                                class="ui-button ui-button--secondary ui-button--sm"
                                disabled={publishing() || creatingCollection()}
                                onClick={() => void newCollection()}
                            >
                                {creatingCollection() ? 'Creating…' : '+ New Collection'}
                            </button>
                        </Show>
                        <span class="gallery-admin__count">
                            {liveCount()} item{liveCount() === 1 ? '' : 's'}
                            <Show when={settings()?.allowVideos === false}> · videos are off (Settings)</Show>
                        </span>
                        <span class="gallery-admin__hint">
                            Drag to reorder{collections().length ? ' · drop on a folder to move' : ''} · click for options
                        </span>
                    </div>

                    <div class="gallery-admin__filters">
                        <MediaSearchInput
                            class="gallery-admin__search"
                            value={filterText()}
                            onSearch={setFilterText}
                            debounce={150}
                            placeholder="Filter by title, caption or tag…"
                        />
                        <select
                            aria-label="Type"
                            value={filterType()}
                            onChange={(e,) => setFilterType(e.currentTarget.value as GalleryTypeFilter,)}
                        >
                            <option value="all">All types</option>
                            <option value="image">Images</option>
                            <option value="video">Videos</option>
                            <option value="featured">Featured</option>
                        </select>
                        <Show when={filtering()}>
                            <span class="form-help-muted">{shownRows().length} of {viewRows().length} shown</span>
                        </Show>
                        <button
                            type="button"
                            class="ui-button ui-button--secondary ui-button--sm"
                            aria-pressed={bulkMode()}
                            disabled={publishing()}
                            onClick={() => (bulkMode() ? endBulk() : setBulkMode(true,))}
                        >
                            {bulkMode() ? 'Done selecting' : 'Select'}
                        </button>
                    </div>

                    <Show when={bulkMode()}>
                        <div class="gallery-admin__bulk" role="toolbar" aria-label="Selected items">
                            <Checkbox
                                checked={allShownPicked()}
                                onChange={(on,) => { for (const r of shownRows()) togglePicked(r.key, on,); }}
                                label="Select all shown"
                            />
                            <span class="form-help-muted">{picked().size} selected</span>
                            <select
                                aria-label="Move selected to"
                                disabled={!picked().size}
                                value=""
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    e.currentTarget.value = '';
                                    if (v) applyBulk({ kind: 'move', collectionId: v === 'root' ? null : v, },);
                                }}
                            >
                                <option value="">Move to…</option>
                                <option value="root">Gallery root</option>
                                <For each={collections()}>{(c,) => <option value={c.id}>{c.name}</option>}</For>
                            </select>
                            <select
                                aria-label="Set visibility of selected"
                                disabled={!picked().size}
                                value=""
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    e.currentTarget.value = '';
                                    if (!v) return;
                                    if (v.startsWith('tier:',)) applyBulk({ kind: 'visibility', visibility: 'tier', minTierId: v.slice(5,), },);
                                    else applyBulk({ kind: 'visibility', visibility: v as 'inherit' | 'public' | 'members', },);
                                }}
                            >
                                <option value="">Visibility…</option>
                                <option value="inherit">Gallery default</option>
                                <option value="public">Public</option>
                                <option value="members">Members</option>
                                <For each={tiers()}>{(t,) => <option value={`tier:${t.id}`}>{t.name}</option>}</For>
                            </select>
                            <select
                                aria-label="Set featured on selected"
                                disabled={!picked().size}
                                value=""
                                onChange={(e,) => {
                                    const v = e.currentTarget.value;
                                    e.currentTarget.value = '';
                                    if (v) applyBulk({ kind: 'featured', isFeatured: v === 'on', },);
                                }}
                            >
                                <option value="">Featured…</option>
                                <option value="on">Mark featured</option>
                                <option value="off">Not featured</option>
                            </select>
                            <span class="gallery-admin__bulk-tag">
                                {/* Applied by the button (or Enter), never per keystroke. */}
                                <input
                                    type="text"
                                    placeholder="Tag"
                                    aria-label="Tag to add to selected"
                                    maxLength={40}
                                    value={bulkTag()}
                                    onChange={(e,) => setBulkTag(e.currentTarget.value,)}
                                    onKeyDown={(e,) => {
                                        if (e.key === 'Enter' && picked().size) {
                                            e.preventDefault();
                                            applyBulk({ kind: 'addTag', tag: e.currentTarget.value, },);
                                            setBulkTag('',);
                                            e.currentTarget.value = '';
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    class="ui-button ui-button--secondary ui-button--sm"
                                    disabled={!picked().size}
                                    onMouseDown={(e,) => e.preventDefault()}
                                    onClick={(e,) => {
                                        const input = (e.currentTarget.previousElementSibling as HTMLInputElement | null);
                                        const tag = input?.value ?? bulkTag();
                                        if (!tag.trim()) return;
                                        applyBulk({ kind: 'addTag', tag, },);
                                        setBulkTag('',);
                                        if (input) input.value = '';
                                    }}
                                >
                                    Add tag
                                </button>
                            </span>
                            <button
                                type="button"
                                class="ui-button ui-button--danger ui-button--sm"
                                disabled={!picked().size}
                                onClick={() => applyBulk({ kind: 'remove', },)}
                            >
                                Remove
                            </button>
                        </div>
                    </Show>

                    <div class="gallery-admin__layout" classList={{ 'has-panel': Boolean(selected() || selectedCollection(),), }}>
                        <div class="gallery-admin__main">
                            <div class="media-grid gallery-admin__grid">
                                <Show
                                    when={openCollection()}
                                    fallback={
                                        <For each={collections()}>
                                            {(c,) => (
                                                <div
                                                    class="media-grid__item gallery-admin__card gallery-admin__folder"
                                                    classList={{
                                                        'is-selected': selectedCollectionId() === c.id,
                                                        'is-drop-target': dragOver() === `c:${c.id}`,
                                                        'is-restricted': isGalleryAccessRuleActive(c.access,),
                                                    }}
                                                    onClick={() => selectCollection(selectedCollectionId() === c.id ? null : c.id,)}
                                                    onDblClick={() => { selectCollection(c.id,); goTo(c.id,); }}
                                                    onDragOver={(e,) => { if (dragFrom()) { e.preventDefault(); setDragOver(`c:${c.id}`,); } }}
                                                    onDragLeave={() => { if (dragOver() === `c:${c.id}`) setDragOver(null,); }}
                                                    onDrop={(e,) => { e.preventDefault(); dropOnFolder(c.id,); }}
                                                    role="button"
                                                    tabindex="0"
                                                    aria-pressed={selectedCollectionId() === c.id}
                                                    aria-label={`Collection ${c.name}, ${collectionCount(c.id,)} items. Double-click to open.`}
                                                    onKeyDown={(e,) => {
                                                        if (e.target !== e.currentTarget) return;
                                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCollection(c.id,); }
                                                    }}
                                                >
                                                    <div class="media-grid__preview gallery-admin__preview gallery-admin__folder-preview">
                                                        <Show when={collectionCover(c,)} fallback={<span class="gallery-admin__folder-icon" aria-hidden="true">📁</span>}>
                                                            {(src,) => <img src={src()} alt="" loading="lazy" />}
                                                        </Show>
                                                        <div class="gallery-admin__badges">
                                                            <span class="gallery-admin__badge gallery-admin__badge--folder">Collection</span>
                                                            <Show when={isGalleryAccessRuleActive(c.access,)}><span class="gallery-admin__badge gallery-admin__badge--vis">Restricted</span></Show>
                                                            <Show when={c.hiddenInGallery}><span class="gallery-admin__badge gallery-admin__badge--hidden" title="Not listed on the gallery pages">Hidden</span></Show>
                                                        </div>
                                                    </div>
                                                    <div class="media-grid__info">
                                                        <div class="media-grid__name" title={c.name}>📁 {c.name}</div>
                                                        <div class="media-grid__meta">
                                                            <span>{collectionCount(c.id,)} item{collectionCount(c.id,) === 1 ? '' : 's'}</span>
                                                        </div>
                                                        <div class="media-grid__actions">
                                                            <button
                                                                type="button"
                                                                class="ui-button ui-button--sm ui-button--ghost"
                                                                onClick={(e,) => { e.stopPropagation(); selectCollection(c.id,); goTo(c.id,); }}
                                                            >
                                                                Open
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </For>
                                    }
                                >
                                    <div
                                        class="media-grid__item gallery-admin__card gallery-admin__folder gallery-admin__back"
                                        classList={{ 'is-drop-target': dragOver() === 'back', }}
                                        onClick={() => goTo(null,)}
                                        onDragOver={(e,) => { if (dragFrom()) { e.preventDefault(); setDragOver('back',); } }}
                                        onDragLeave={() => { if (dragOver() === 'back') setDragOver(null,); }}
                                        onDrop={(e,) => { e.preventDefault(); dropOnFolder(null,); }}
                                        role="button"
                                        tabindex="0"
                                        aria-label="Back to the gallery (drop an item here to move it out of the collection)"
                                        onKeyDown={(e,) => {
                                            if (e.target !== e.currentTarget) return;
                                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(null,); }
                                        }}
                                    >
                                        <div class="media-grid__preview gallery-admin__preview gallery-admin__folder-preview">
                                            <span class="gallery-admin__folder-icon" aria-hidden="true">↑</span>
                                        </div>
                                        <div class="media-grid__info">
                                            <div class="media-grid__name">↑ Back to gallery</div>
                                            <div class="media-grid__meta"><span>Drop here to move out</span></div>
                                        </div>
                                    </div>
                                </Show>
                                <For each={shownRows()}>
                                    {(r,) => (
                                        <div
                                            class="media-grid__item gallery-admin__card"
                                            classList={{
                                                'is-selected': bulkMode() ? picked().has(r.key,) : selectedKey() === r.key,
                                                'is-removed': Boolean(r.removed,),
                                                'is-new': !r.id,
                                                'is-drag-over': dragOver() === r.key && dragFrom() !== r.key,
                                                'is-missing': Boolean(r.id && !r.media,),
                                            }}
                                            draggable={!publishing()}
                                            onDragStart={(e,) => { setDragFrom(r.key,); e.dataTransfer?.setData('text/plain', r.key,); }}
                                            onDragOver={(e,) => { e.preventDefault(); setDragOver(r.key,); }}
                                            onDragEnd={endDrag}
                                            onDrop={(e,) => { e.preventDefault(); onDrop(r.key,); }}
                                            onClick={() => (bulkMode() ? togglePicked(r.key,) : selectItem(selectedKey() === r.key ? null : r.key,))}
                                            role="button"
                                            tabindex="0"
                                            aria-pressed={bulkMode() ? picked().has(r.key,) : selectedKey() === r.key}
                                            onKeyDown={(e,) => {
                                                if (e.target !== e.currentTarget) return;
                                                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (bulkMode()) togglePicked(r.key,); else selectItem(r.key,); }
                                                if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); nudge(r.key, -1,); }
                                                if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); nudge(r.key, 1,); }
                                            }}
                                        >
                                            <div class="media-grid__preview gallery-admin__preview">
                                                <Show when={bulkMode()}>
                                                    <div class="gallery-admin__pick" onClick={(e,) => e.stopPropagation()}>
                                                        <Checkbox
                                                            checked={picked().has(r.key,)}
                                                            onChange={(on,) => togglePicked(r.key, on,)}
                                                            label={<span class="sr-only">Select {displayTitle(r,)}</span>}
                                                        />
                                                    </div>
                                                </Show>
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
                                                    <Show when={isGalleryAccessRuleActive(r.options.access,)}><span class="gallery-admin__badge gallery-admin__badge--vis">Restricted</span></Show>
                                                    <Show when={r.options.hiddenInGallery}><span class="gallery-admin__badge gallery-admin__badge--hidden" title="Not listed on the gallery pages">Hidden</span></Show>
                                                    <Show when={r.options.isFeatured}><span class="gallery-admin__badge gallery-admin__badge--featured" title="Is featured">★ Featured</span></Show>
                                                    <Show when={r.file}><span class="gallery-admin__badge gallery-admin__badge--pending">To upload</span></Show>
                                                    <Show when={!r.id && !r.file}><span class="gallery-admin__badge gallery-admin__badge--new">New</span></Show>
                                                </div>
                                                <Show when={isUploadingRow(r,) || isProcessingRow(r,)}>
                                                    <button
                                                        type="button"
                                                        class="gallery-admin__cancel"
                                                        disabled={Boolean(cancelling[r.key],)}
                                                        title={isUploadingRow(r,) ? 'Cancel this upload' : 'Stop processing and delete'}
                                                        aria-label={isUploadingRow(r,) ? `Cancel upload of ${displayTitle(r,)}` : `Cancel processing of ${displayTitle(r,)}`}
                                                        onClick={(e,) => { e.stopPropagation(); void cancelRow(r,); }}
                                                    >
                                                        &times; Cancel
                                                    </button>
                                                </Show>
                                                <Show when={isProcessingRow(r,) && !publishing()}>
                                                    <div class="gallery-admin__progress"><span>Processing…</span></div>
                                                </Show>
                                                <Show when={publishing() && progress[r.key] !== undefined}>
                                                    <div class="gallery-admin__progress">
                                                        <div class="video-progress"><div class="video-progress__fill" style={{ width: `${progress[r.key]}%`, }} /></div>
                                                        <span>{progress[r.key]}%</span>
                                                    </div>
                                                </Show>
                                            </div>
                                            <div class="media-grid__info">
                                                <Show
                                                    when={r.file}
                                                    fallback={<div class="media-grid__name" title={displayTitle(r,)}>{displayTitle(r,)}</div>}
                                                >
                                                    {/* The media title of a staged file — editable until its upload
                                                        completes (commits on blur / Enter). */}
                                                    <input
                                                        type="text"
                                                        class="gallery-admin__title-input"
                                                        value={r.uploadTitle ?? defaultTitle(r.file!.name,)}
                                                        maxLength={255}
                                                        placeholder={defaultTitle(r.file!.name,)}
                                                        aria-label={`Title for ${r.file!.name}`}
                                                        title={r.file!.name}
                                                        onClick={(e,) => e.stopPropagation()}
                                                        onKeyDown={(e,) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                                                        onChange={(e,) => patchRow(r.key, { uploadTitle: e.currentTarget.value, },)}
                                                    />
                                                </Show>
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
                            <Show when={!viewRows().length}>
                                <div class="empty-state gallery-admin__empty">
                                    <Show
                                        when={openCollection()}
                                        fallback={
                                            <>
                                                <p>{collections().length ? 'No items outside the collections.' : 'The gallery is empty.'}</p>
                                                <p class="form-help-muted">Add media from the library or upload new files, then publish.</p>
                                            </>
                                        }
                                    >
                                        <p>This collection is empty.</p>
                                        <p class="form-help-muted">Add or upload media here, or drag items onto its folder from the gallery.</p>
                                    </Show>
                                </div>
                            </Show>
                        </div>

                        <Show when={selectedCollection()}>
                            {(c,) => (
                                <CollectionPanel
                                    collection={c()}
                                    itemCount={collectionCount(c().id,)}
                                    roles={roleOptions()}
                                    tiers={tierOptions()}
                                    isOpen={openId() === c().id}
                                    onSave={(input,) => saveCollection(c().id, input,)}
                                    onOpen={() => goTo(c().id,)}
                                    onDelete={() => setDeleteTarget(c(),)}
                                    onClose={() => setSelectedCollectionId(null,)}
                                />
                            )}
                        </Show>
                        <Show when={selected()}>
                            {(r,) => (
                                <GalleryItemPanel
                                    item={r()}
                                    defaults={galleryDefaults()}
                                    tiers={tiers()}
                                    commentsOn={commentsOn()}
                                    roleOptions={roleOptions()}
                                    tierOptions={tierOptions()}
                                    collections={collections()}
                                    onMove={(id,) => void moveRow(r().key, id,)}
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

            <DeleteCollectionModal
                collection={deleteTarget()}
                itemCount={deleteTarget() ? collectionCount(deleteTarget()!.id,) : 0}
                collections={collections()}
                busy={deletingCollection()}
                onConfirm={(choice,) => void deleteCollection(choice,)}
                onCancel={() => setDeleteTarget(null,)}
            />
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
                open={conflictOpen()}
                title="The gallery changed"
                message="Someone else published, edited, added or removed gallery items since you loaded this page. Publish anyway to replace their changes with yours, or reload to see theirs (your unpublished changes are dropped)."
                confirmLabel="Publish anyway"
                cancelLabel="Keep editing"
                danger
                onConfirm={() => { setConflictOpen(false,); void publish({ overwrite: true, },); }}
                onCancel={() => setConflictOpen(false,)}
            >
                <p class="form-help-muted">
                    <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => void reloadAfterConflict()}>
                        Reload and drop my changes
                    </button>
                </p>
            </ConfirmModal>
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
