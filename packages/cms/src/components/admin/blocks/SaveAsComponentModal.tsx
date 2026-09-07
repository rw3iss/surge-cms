/**
 * "Save as Component" — clone a block (and its nested children) into a reusable
 * Component under /admin/components.
 *
 * A CLONE, not a move: the block stays exactly where it is. Converting it into
 * a `template` reference in place would silently change what the page renders
 * the moment someone edits the component, which is not what "save a copy of
 * this" implies. Swap it for a Component block yourself if that is what you want.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { A, } from '@solidjs/router';
import type { BlockData, } from './ContentBlock';
import { cms, } from '../../../services/cmsClient';
import { editorToBackend, } from '../mail/blockConverters';
import FormField from '../forms/FormField';
import ModalShell from '../common/ModalShell';

export interface SaveAsComponentModalProps {
    /** The block to clone. */
    block: BlockData;
    /** The page's full FLAT block list — the editor nests via `parentBlockId`,
     *  so a group's children have to be gathered from here. */
    allBlocks: BlockData[];
    onClose: () => void;
}

/**
 * The block plus every descendant, in a flat list.
 *
 * A group is only meaningful with its slots and their contents, so saving one
 * has to take the whole subtree. Ids are preserved: `parentBlockId` links point
 * at them, and the server accepts a client-supplied id.
 */
function collectSubtree(root: BlockData, all: BlockData[],): BlockData[] {
    const out: BlockData[] = [];
    const walk = (b: BlockData, parentId: string | null,) => {
        out.push({ ...b, parentBlockId: parentId, },);
        for (const child of all.filter((x,) => x.parentBlockId === b.id)) walk(child, b.id,);
    };
    // The root is detached from whatever held it on the page.
    walk(root, null,);
    return out;
}

const SaveAsComponentModal: Component<SaveAsComponentModalProps> = (props,) => {
    const [name, setName,] = createSignal('',);
    const [description, setDescription,] = createSignal('',);
    const [saving, setSaving,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);
    const [savedId, setSavedId,] = createSignal<string | null>(null,);

    const handleSave = async () => {
        const trimmed = name().trim();
        if (!trimmed) { setError('Give the component a name.',); return; }
        setSaving(true,);
        setError(null,);
        try {
            const created = await cms.components.create({
                name: trimmed,
                description: description().trim() || undefined,
                mode: 'single',
            } as never,);
            // Same mapper the mail + entity template editors use, so a block
            // saved here round-trips through the identical shape.
            const rows = editorToBackend(collectSubtree(props.block, props.allBlocks,),);
            await cms.components.saveBlocks(created.id, rows as never,);
            setSavedId(created.id,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the component.',);
        } finally {
            setSaving(false,);
        }
    };

    return (
        <ModalShell open onClose={props.onClose} size="sm" showClose ariaLabel="Save as Component">
            <h2 class="save-component-modal__title">Save as Component</h2>
            <Show
                when={!savedId()}
                fallback={
                    <div class="save-component-modal__done">
                        <p>
                            Saved. Insert it anywhere with a <strong>Component</strong> block —
                            edits to the component update every use.
                        </p>
                        <div class="save-component-modal__actions">
                            <A
                                href={`/admin/components/${savedId()}`}
                                class="ui-button ui-button--secondary"
                            >
                                Open component
                            </A>
                            <button class="ui-button ui-button--primary" onClick={props.onClose}>
                                Done
                            </button>
                        </div>
                    </div>
                }
            >
                <Show when={error()}>
                    <div class="alert alert--error">{error()}</div>
                </Show>

                <FormField label="Name" hint="Shown in the Component block's picker.">
                    <input
                        type="text"
                        value={name()}
                        // Commit-on-blur is the rule for form state, but a modal
                        // whose only field feeds a Save button needs the current
                        // value on every keystroke to enable/disable it — and
                        // nothing above this input re-renders, so focus is safe.
                        onInput={(e,) => setName(e.currentTarget.value,)}
                        placeholder="e.g. Newsletter signup band"
                        autofocus
                        disabled={saving()}
                    />
                </FormField>

                <FormField label="Description" hint="Optional — helps when picking it later.">
                    <textarea
                        rows={2}
                        value={description()}
                        onInput={(e,) => setDescription(e.currentTarget.value,)}
                        disabled={saving()}
                    />
                </FormField>

                <p class="form-help-muted">
                    The block stays on this page. This saves a copy you can reuse elsewhere.
                </p>

                <div class="save-component-modal__actions">
                    <button class="ui-button ui-button--secondary" onClick={props.onClose} disabled={saving()}>
                        Cancel
                    </button>
                    <button
                        class="ui-button ui-button--primary"
                        onClick={() => void handleSave()}
                        disabled={saving() || !name().trim()}
                    >
                        {saving() ? 'Saving…' : 'Save component'}
                    </button>
                </div>
            </Show>
        </ModalShell>
    );
};

export default SaveAsComponentModal;
