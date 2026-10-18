/**
 * Gallery admin → the selected COLLECTION (side panel). Unlike item options,
 * a collection is not part of the gallery draft: its name, description,
 * "Hide from gallery" and access save straight to the server with **Save**. Text fields commit to the
 * panel's local copy on blur / Enter (project rule).
 */
import type { GalleryAccessRule, GalleryCollection, GalleryCollectionInput, } from '@sitesurge/types';
import { createEffect, createMemo, createSignal, on, Show, } from 'solid-js';
import { createStore, } from 'solid-js/store';
import type { MultiSelectOption, } from '../../ui/MultiSelect';
import Toggle from '../common/Toggle';
import { FormField, } from '../forms';
import AccessRuleEditor from './AccessRuleEditor';
import CommitInput from './CommitInput';
import CopyButton, { absoluteUrl, } from './CopyButton';
import { copyAccess, } from './galleryDraft';

export interface CollectionPanelProps {
    collection: GalleryCollection;
    /** Items in the collection (draft count). */
    itemCount: number;
    roles: MultiSelectOption[];
    tiers: MultiSelectOption[];
    /** Already inside this collection (hides Open). */
    isOpen: boolean;
    onSave: (input: GalleryCollectionInput,) => Promise<void>;
    onOpen: () => void;
    onDelete: () => void;
    onClose: () => void;
}

interface Local { name: string; description: string; access: GalleryAccessRule; hiddenInGallery: boolean; }

const localOf = (c: GalleryCollection,): Local => ({
    name: c.name, description: c.description ?? '', access: copyAccess(c.access,), hiddenInGallery: Boolean(c.hiddenInGallery,),
});

export default function CollectionPanel(props: CollectionPanelProps,) {
    const [local, setLocal,] = createStore<Local>(localOf(props.collection,),);
    const [saving, setSaving,] = createSignal(false,);

    // A different collection (or a fresh copy after Save) resets the local copy.
    createEffect(on(() => [props.collection.id, props.collection.updatedAt,], () => setLocal(localOf(props.collection,),),),);

    const dirty = createMemo(() => JSON.stringify(local,) !== JSON.stringify(localOf(props.collection,),));

    const save = async () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        await Promise.resolve();
        if (!dirty() || saving()) return;
        setSaving(true,);
        try {
            await props.onSave({ name: local.name.trim() || 'Untitled', description: local.description, access: copyAccess(local.access,), hiddenInGallery: local.hiddenInGallery, },);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <aside class="gallery-panel" aria-label="Collection options">
            <div class="gallery-panel__head">
                <span class="gallery-panel__kind" aria-hidden="true">📁</span>
                <h3 title={props.collection.name}>{props.collection.name}</h3>
                <button type="button" class="gallery-panel__close" aria-label="Close options" onClick={props.onClose}>&times;</button>
            </div>

            {/* Collection changes save at once (C5) — unlike item edits and moves, which wait for Publish. */}
            <p class="form-help-muted gallery-panel__saved">Collection changes are saved immediately.</p>
            <p class="gallery-panel__comments">
                {props.itemCount} item{props.itemCount === 1 ? '' : 's'} ·{' '}
                <a href={props.collection.url} target="_blank" rel="noopener">View public page ↗</a>
            </p>
            <div class="gallery-panel__links">
                <CopyButton label="Copy page link" text={() => absoluteUrl(props.collection.url,)} />
                <CopyButton label="Copy template" text={() => `{{gallery(collection='${props.collection.id}')}}`} />
            </div>
            <Show when={!props.isOpen}>
                <div class="gallery-panel__links">
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={props.onOpen}>Open collection</button>
                </div>
            </Show>

            <FormField label="Name">
                <CommitInput value={local.name} placeholder="Untitled" onCommit={(v,) => setLocal('name', v,)} />
            </FormField>
            <FormField label="Description" hint="Shown on the collection's page.">
                <CommitInput multiline rows={4} value={local.description} onCommit={(v,) => setLocal('description', v,)} />
            </FormField>

            <Toggle
                checked={local.hiddenInGallery}
                onChange={(v,) => setLocal('hiddenInGallery', v,)}
                label="Hide from gallery"
                hint="Still usable in Gallery blocks, templates and emails, and its own page still works — it is just not listed on the gallery pages. Its items are not listed either, except on its own page."
            />

            <AccessRuleEditor
                value={local.access}
                onChange={(access,) => setLocal('access', access,)}
                roles={props.roles}
                tiers={props.tiers}
            />
            <p class="form-help-muted">An item's own restriction overrides the collection's.</p>

            <div class="gallery-panel__foot gallery-panel__actions">
                <button type="button" class="ui-button ui-button--danger ui-button--sm" disabled={saving()} onClick={props.onDelete}>Delete</button>
                <button type="button" class="ui-button ui-button--primary ui-button--sm" disabled={!dirty() || saving()} onClick={() => void save()}>
                    {saving() ? 'Saving…' : 'Save'}
                </button>
            </div>
        </aside>
    );
}
