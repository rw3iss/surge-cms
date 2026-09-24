/**
 * Draft tracking compares against a BASELINE rather than setting a flag.
 *
 * A flag set by every `onInput` answers "was something typed?", not "is
 * anything different?" — so typing a character and deleting it leaves the
 * editor claiming unsaved changes forever, and there is nothing for a Revert
 * button to revert TO.
 */
import { createRoot, createSignal, } from 'solid-js';
import { describe, expect, it, } from 'vitest';
import { useEditorDraft, } from './useEditorDraft';

/** Run a hook inside a reactive root, as a component would. */
function withRoot<T,>(fn: () => T,): T {
    let out!: T;
    createRoot(() => { out = fn(); },);
    return out;
}

describe('useEditorDraft', () => {
    it('is not dirty before a baseline is captured', () => {
        // The editor is still loading; flashing an unsaved-changes bar on every
        // page open would be worse than useless.
        const { draft, } = withRoot(() => {
            const [state,] = createSignal({ name: 'a', },);
            return { draft: useEditorDraft({ current: state, },), };
        },);
        expect(draft.isDirty(),).toBe(false,);
        expect(draft.baseline(),).toBeNull();
    },);

    it('is clean immediately after capture', () => {
        const { draft, } = withRoot(() => {
            const [state,] = createSignal({ name: 'a', },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, };
        },);
        expect(draft.isDirty(),).toBe(false,);
    },);

    it('becomes dirty when the state diverges', () => {
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ name: 'a', },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ name: 'b', },);
        expect(draft.isDirty(),).toBe(true,);
    },);

    it('goes CLEAN again when an edit is undone', () => {
        // The whole reason for comparing rather than flagging.
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ name: 'a', },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ name: 'b', },);
        expect(draft.isDirty(),).toBe(true,);
        set({ name: 'a', },);
        expect(draft.isDirty(),).toBe(false,);
    },);

    it('capture after a save makes the new state the baseline', () => {
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ name: 'a', },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ name: 'b', },);
        draft.capture({ name: 'b', },);
        expect(draft.isDirty(),).toBe(false,);
    },);

    it('revert returns the baseline, not a reference to it', () => {
        // The caller writes this back into its signals; handing out the stored
        // object would let a later edit mutate the baseline itself, and the
        // editor would never look dirty again.
        const { draft, original, } = withRoot(() => {
            const original = { nested: { v: 1, }, };
            const [state,] = createSignal(original,);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(original,);
            return { draft, original, };
        },);
        const reverted = draft.revert()!;
        expect(reverted,).toEqual(original,);
        reverted.nested.v = 99;
        expect(draft.baseline()!.nested.v,).toBe(1,);
    },);

    it('capture stores a copy, so later mutation of the source does not move the baseline', () => {
        const { draft, source, } = withRoot(() => {
            const source = { name: 'a', };
            const [state,] = createSignal(source,);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(source,);
            return { draft, source, };
        },);
        source.name = 'mutated';
        expect(draft.baseline()!.name,).toBe('a',);
    },);

    it('revert returns null with no baseline', () => {
        const { draft, } = withRoot(() => {
            const [state,] = createSignal({ name: 'a', },);
            return { draft: useEditorDraft({ current: state, },), };
        },);
        expect(draft.revert(),).toBeNull();
    },);

    it('reset forgets the baseline', () => {
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ name: 'a', },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ name: 'b', },);
        expect(draft.isDirty(),).toBe(true,);
        draft.reset();
        expect(draft.isDirty(),).toBe(false,);
    },);

    it('honours a custom equals', () => {
        // e.g. ignoring a field the editor rewrites on every keystroke.
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ name: 'a', touchedAt: 1, },);
            const draft = useEditorDraft({
                current: state,
                equals: (x, y,) => x.name === y.name,
            },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ name: 'a', touchedAt: 999, },);
        expect(draft.isDirty(),).toBe(false,);
        set({ name: 'b', touchedAt: 999, },);
        expect(draft.isDirty(),).toBe(true,);
    },);

    it('detects a change nested inside arrays (the block list)', () => {
        const { draft, set, } = withRoot(() => {
            const [state, set,] = createSignal({ blocks: [{ id: '1', type: 'rich_text', },], },);
            const draft = useEditorDraft({ current: state, },);
            draft.capture(state(),);
            return { draft, set, };
        },);
        set({ blocks: [{ id: '1', type: 'html', },], },);
        expect(draft.isDirty(),).toBe(true,);
    },);
},);
