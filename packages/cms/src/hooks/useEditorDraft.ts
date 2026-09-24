/**
 * Draft tracking for an editor whose state lives in plain signals.
 *
 * `useEntityEditor` already does this for pages and posts, but it brings
 * revisions, soft-delete, autosave, slugs and publish status with it — none of
 * which a mail template has. This is the part those editors genuinely share:
 * remember what was loaded, know whether the form has diverged from it, and be
 * able to put it back.
 *
 * **Snapshot-based rather than a dirty FLAG.** A flag set by every `onInput`
 * says "something was typed", not "something is different", so typing a
 * character and deleting it leaves the editor claiming unsaved changes
 * forever. Comparing against the baseline means the answer is always the true
 * one, and it is what makes Revert possible at all — a flag has nothing to
 * revert TO.
 */
import { createMemo, createSignal, } from 'solid-js';

export interface EditorDraft<TState,> {
    /** The state as last loaded or saved. Null until `capture` runs. */
    baseline: () => TState | null;
    /** Does the current state differ from the baseline? */
    isDirty: () => boolean;
    /**
     * Record the current state as the new baseline — on load, and after every
     * successful save. Clears the dirty state by definition.
     */
    capture: (state: TState,) => void;
    /** The baseline, for a caller about to write it back over the form. */
    revert: () => TState | null;
    /** Forget the baseline (nothing to compare or revert to). */
    reset: () => void;
}

export interface UseEditorDraftOptions<TState,> {
    /** Reads the editor's current state. Must be reactive. */
    current: () => TState;
    /**
     * Compare baseline to current. Defaults to a JSON comparison, which is
     * right for plain form state; pass your own when the state holds values
     * JSON cannot round-trip faithfully.
     */
    equals?: (a: TState, b: TState,) => boolean;
}

/** JSON comparison: adequate for form state, which is strings/booleans/arrays. */
function defaultEquals<T,>(a: T, b: T,): boolean {
    return JSON.stringify(a,) === JSON.stringify(b,);
}

export function useEditorDraft<TState,>(
    opts: UseEditorDraftOptions<TState>,
): EditorDraft<TState> {
    const [baseline, setBaseline,] = createSignal<TState | null>(null,);
    const same = opts.equals ?? defaultEquals;

    const isDirty = createMemo(() => {
        const base = baseline();
        // No baseline yet means the editor is still loading. Reporting "dirty"
        // there would flash an unsaved-changes bar on every page open.
        if (base === null) return false;
        return !same(base, opts.current(),);
    },);

    return {
        baseline,
        isDirty,
        capture: (state,) => setBaseline(() => structuredClone(state,)),
        revert: () => {
            const base = baseline();
            return base === null ? null : structuredClone(base,);
        },
        reset: () => setBaseline(null,),
    };
}
