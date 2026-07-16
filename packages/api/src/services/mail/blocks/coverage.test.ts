import { describe, expect, it, } from 'vitest';
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';
import { RENDERERS, } from './index';

describe('mail block registry coverage', () => {
    it('every BlockType has an email renderer', () => {
        for (const t of ALL_BLOCK_TYPES) {
            expect(RENDERERS[t], `missing email renderer for ${t}`,).toBeTypeOf('function',);
        }
    });

    it('registry has no renderer for a type outside the catalog', () => {
        const extra = Object.keys(RENDERERS,).filter(
            (k,) => !(ALL_BLOCK_TYPES as readonly string[]).includes(k,),
        );
        expect(extra,).toEqual([],);
    });
});
