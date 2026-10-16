import { describe, expect, it, } from 'vitest';
import { stableSelection, } from './stableSelection';

type B = { id: string; v?: number; };

describe('stableSelection', () => {
    it('returns the live block while it exists', () => {
        let blocks: B[] = [{ id: 'a', v: 1, }, { id: 'b', v: 1, },];
        const get = stableSelection<B>('a', (id) => blocks.find((b) => b.id === id));
        expect(get().v,).toBe(1,);
        blocks = [{ id: 'a', v: 2, }, { id: 'b', v: 1, },];
        expect(get().v,).toBe(2,);
    },);

    it('keeps the last block when the lookup goes null (panel teardown)', () => {
        let present = true;
        const blocks: B[] = [{ id: 'a', v: 1, },];
        const get = stableSelection<B>('a', (id) => (present ? blocks.find((b) => b.id === id) : null));
        expect(get().id,).toBe('a',);
        present = false; // deleted / deselected before the panel is disposed
        const read = () => get().id;
        expect(read,).not.toThrow();
        expect(read(),).toBe('a',);
    },);

    it('never adopts a different block for the id', () => {
        const get = stableSelection<B>('a', () => ({ id: 'b', }));
        expect(get,).toThrow();
    },);
},);
