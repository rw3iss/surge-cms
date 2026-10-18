/** A1: partial-upload recovery — a retry after a failure uploads only what is still staged. */
import { describe, expect, it, } from 'vitest';
import { EMPTY_OPTIONS, type DraftItem, } from './galleryDraft';
import { uploadStaged, } from './publishGallery';

const staged = (key: string,): DraftItem => ({ key, file: { name: `${key}.png`, } as File, media: null, options: EMPTY_OPTIONS, });

function page(rows: DraftItem[],) {
    const state = { rows, };
    const onUploaded = (key: string, mediaId: string,) => {
        // What GalleryAdmin does: the row becomes a library row (file dropped, mediaId set).
        state.rows = state.rows.map((r,) => (r.key === key ? { ...r, file: undefined, mediaId, } : r));
    };
    return { state, onUploaded, };
}

describe('uploadStaged', () => {
    it('some upload, one fails → the error carries the successes; the retry uploads only the rest', async () => {
        const p = page([staged('a',), staged('b',), staged('c',),],);
        const calls: string[] = [];
        let failB = true;
        const upload = async (r: DraftItem,) => {
            calls.push(r.key,);
            if (r.key === 'b' && failB) throw new Error('network',);
            return `m-${r.key}`;
        };
        const err = await uploadStaged({ rows: () => p.state.rows, upload, isCancelled: () => false, onUploaded: p.onUploaded, },).catch((e,) => e);
        expect(err.message,).toBe('network',);
        expect([...err.uploaded.entries(),],).toEqual([['a', 'm-a',],],);
        expect(p.state.rows.find((r,) => r.key === 'a',)!.mediaId,).toBe('m-a',);

        failB = false;
        calls.length = 0;
        const again = await uploadStaged({ rows: () => p.state.rows, upload, isCancelled: () => false, onUploaded: p.onUploaded, },);
        expect(calls,).toEqual(['b', 'c',],);
        expect([...again.keys(),],).toEqual(['b', 'c',],);
    });

    it('skips a row cancelled before its turn, and one whose upload was cancelled', async () => {
        const p = page([staged('a',), staged('b',), staged('c',),],);
        const cancelled = new Error('cancelled',);
        const r = await uploadStaged({
            rows: () => p.state.rows,
            upload: async (row,) => {
                if (row.key === 'a') p.state.rows = p.state.rows.filter((x,) => x.key !== 'b',); // b cancelled meanwhile
                if (row.key === 'c') throw cancelled;
                return `m-${row.key}`;
            },
            isCancelled: (e,) => e === cancelled,
            onUploaded: p.onUploaded,
        },);
        expect([...r.keys(),],).toEqual(['a',],);
    });

    it('never uploads removed rows', async () => {
        const p = page([{ ...staged('a',), removed: true, }, staged('b',),],);
        const keys: string[] = [];
        await uploadStaged({ rows: () => p.state.rows, upload: async (r,) => { keys.push(r.key,); return 'm'; }, isCancelled: () => false, onUploaded: p.onUploaded, },);
        expect(keys,).toEqual(['b',],);
    });
});
