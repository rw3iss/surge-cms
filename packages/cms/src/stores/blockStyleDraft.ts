/**
 * The style being edited RIGHT NOW, for live preview.
 *
 * The style panel deliberately does not write to the block while you type:
 * `props.onUpdate` replaces the block's data, which re-renders the whole
 * `ContentBlock` — including the panel you are typing in — stealing focus and
 * jumping the scroll position. So edits accumulated in a local signal and the
 * preview only caught up when you pressed Save, which meant choosing a padding
 * or a background colour was guesswork.
 *
 * This is the side channel that fixes it. The panel publishes its in-progress
 * style here; `BlockPreview` reads it and prefers it over the block's saved
 * style. Nothing in the block tree changes, so the editor doesn't re-render and
 * the inputs keep focus — but the preview updates on every keystroke.
 *
 * Keyed by block id: several blocks can be open across a page (and a group's
 * children render inside their parent's preview), so a single global draft
 * would paint one block's edits onto another.
 *
 * Lifecycle: Save commits to the block and clears the draft; Cancel clears it
 * and the preview falls back to the saved style — which is exactly "revert".
 */
import { createSignal, } from 'solid-js';

/** Style shape is the block-style property bag; kept loose to avoid a
 *  dependency cycle with the style service. */
type DraftStyle = Record<string, unknown>;

const [drafts, setDrafts,] = createSignal<Record<string, DraftStyle>>({},);

/** Publish (or replace) the in-progress style for one block. */
export function setStyleDraft(blockId: string, style: DraftStyle,): void {
    setDrafts((prev,) => ({ ...prev, [blockId]: style, }),);
}

/**
 * Drop a block's draft.
 *
 * Called on BOTH Save and Cancel: after a save the committed style is on the
 * block itself, so a lingering draft would shadow any later change made from
 * elsewhere; after a cancel, dropping it IS the revert.
 */
export function clearStyleDraft(blockId: string,): void {
    setDrafts((prev,) => {
        if (!(blockId in prev)) return prev;
        const next = { ...prev, };
        delete next[blockId];
        return next;
    },);
}

/** The in-progress style for a block, or undefined when not being edited. */
export function styleDraft(blockId: string,): DraftStyle | undefined {
    return drafts()[blockId];
}
