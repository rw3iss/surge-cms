/**
 * The live style-preview channel.
 *
 * Exists because the style panel cannot write to the block while you type
 * (that re-renders the panel and steals focus), so the preview only caught up
 * on Save and choosing a padding or colour was guesswork.
 *
 * Its own hazards are leakage between blocks and drafts outliving the edit —
 * both would paint one block's in-progress style onto another.
 */
import { beforeEach, describe, expect, it, } from 'vitest';
import { clearStyleDraft, setStyleDraft, styleDraft, } from './blockStyleDraft';

beforeEach(() => {
    clearStyleDraft('a',);
    clearStyleDraft('b',);
},);

describe('blockStyleDraft', () => {
    it('returns undefined when a block is not being edited', () => {
        // Undefined (not `{}`) is what lets BlockPreview's `??` fall through to
        // the block's SAVED style — an empty object would shadow it and strip
        // every style the block actually has.
        expect(styleDraft('a',),).toBeUndefined();
    },);

    it('reads back what was published', () => {
        setStyleDraft('a', { padding: '20px', },);
        expect(styleDraft('a',),).toEqual({ padding: '20px', },);
    },);

    it('replaces, rather than merges, on each keystroke', () => {
        // The panel owns the whole style object; merging would resurrect a
        // property the operator just cleared.
        setStyleDraft('a', { padding: '20px', background: 'red', },);
        setStyleDraft('a', { padding: '30px', },);
        expect(styleDraft('a',),).toEqual({ padding: '30px', },);
    },);

    it('keeps blocks independent', () => {
        // A group's children render inside their parent's preview, so a shared
        // draft would paint one block's edits onto its siblings.
        setStyleDraft('a', { padding: '10px', },);
        setStyleDraft('b', { padding: '99px', },);
        expect(styleDraft('a',),).toEqual({ padding: '10px', },);
        expect(styleDraft('b',),).toEqual({ padding: '99px', },);
    },);

    it('clearing one leaves the other alone', () => {
        setStyleDraft('a', { padding: '10px', },);
        setStyleDraft('b', { padding: '99px', },);
        clearStyleDraft('a',);
        expect(styleDraft('a',),).toBeUndefined();
        expect(styleDraft('b',),).toEqual({ padding: '99px', },);
    },);

    it('clearing is the revert — the saved style takes over again', () => {
        setStyleDraft('a', { padding: '99px', },);
        clearStyleDraft('a',);
        expect(styleDraft('a',),).toBeUndefined();
    },);

    it('clearing an unknown block is a no-op', () => {
        // Runs on unmount for every block, edited or not.
        expect(() => clearStyleDraft('never-edited',),).not.toThrow();
    },);
},);
