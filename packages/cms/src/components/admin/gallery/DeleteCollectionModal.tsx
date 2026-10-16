/**
 * Confirm deleting a gallery collection, choosing what happens to its items:
 * delete them from the gallery (optionally their media too — the same choice
 * as removing a single item), move them to the gallery root, or move them to
 * another collection. An empty collection is a plain confirmation.
 */
import type { GalleryCollection, GalleryCollectionDeleteMode, } from '@sitesurge/types';
import { createEffect, createSignal, For, on, Show, } from 'solid-js';
import { RadioGroup, } from '../../ui/RadioGroup';
import ConfirmModal from '../common/ConfirmModal';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';

export interface DeleteCollectionChoice {
    items: GalleryCollectionDeleteMode;
    targetId?: string;
    deleteMedia?: boolean;
}

export interface DeleteCollectionModalProps {
    /** The collection being deleted (null = closed). */
    collection: GalleryCollection | null;
    /** Items in it (draft count, incl. unpublished ones). */
    itemCount: number;
    /** Every collection (the others become move targets). */
    collections: GalleryCollection[];
    busy: boolean;
    onConfirm: (choice: DeleteCollectionChoice,) => void;
    onCancel: () => void;
}

export default function DeleteCollectionModal(props: DeleteCollectionModalProps,) {
    const [mode, setMode,] = createSignal<GalleryCollectionDeleteMode>('root',);
    const [targetId, setTargetId,] = createSignal('',);
    const [deleteMedia, setDeleteMedia,] = createSignal(false,);

    const others = () => props.collections.filter((c,) => c.id !== props.collection?.id,);
    const n = () => props.itemCount;
    const plural = () => (n() === 1 ? '' : 's');

    // Each opening starts from the safe choice.
    createEffect(on(() => props.collection?.id, () => { setMode('root',); setTargetId('',); setDeleteMedia(false,); },),);

    const canConfirm = () => n() === 0 || mode() !== 'move' || Boolean(targetId(),);
    const confirm = () => {
        if (!canConfirm()) return;
        if (n() === 0) return props.onConfirm({ items: 'root', },);
        if (mode() === 'move') return props.onConfirm({ items: 'move', targetId: targetId(), },);
        if (mode() === 'delete') return props.onConfirm({ items: 'delete', deleteMedia: deleteMedia(), },);
        props.onConfirm({ items: 'root', },);
    };

    const options = () => [
        { value: 'delete' as const, label: `Delete the ${n()} item${plural()} from the gallery` },
        { value: 'root' as const, label: `Move the item${plural()} to the gallery root` },
        ...(others().length ? [{ value: 'move' as const, label: 'Move them to another collection', },] : []),
    ];

    return (
        <ConfirmModal
            open={Boolean(props.collection,)}
            title={`Delete "${props.collection?.name ?? ''}"?`}
            message={n() === 0 ? 'The collection is empty. This cannot be undone.' : `The collection holds ${n()} item${plural()}. What should happen to ${n() === 1 ? 'it' : 'them'}?`}
            confirmLabel="Delete collection"
            busyLabel="Deleting…"
            loading={props.busy}
            confirmDisabled={!canConfirm()}
            danger
            onConfirm={confirm}
            onCancel={props.onCancel}
        >
            <Show when={n() > 0}>
                <div class="gallery-delete-collection">
                    <RadioGroup name="gallery-collection-delete" value={mode()} onChange={setMode} options={options()} />
                    <Show when={mode() === 'delete'}>
                        <Toggle checked={deleteMedia()} onChange={setDeleteMedia} label="Also delete their media from the library" />
                    </Show>
                    <Show when={mode() === 'move'}>
                        <FormField label="Move to">
                            <select value={targetId()} onChange={(e,) => setTargetId(e.currentTarget.value,)}>
                                <option value="">Choose a collection…</option>
                                <For each={others()}>{(c,) => <option value={c.id}>{c.name}</option>}</For>
                            </select>
                        </FormField>
                    </Show>
                </div>
            </Show>
        </ConfirmModal>
    );
}
