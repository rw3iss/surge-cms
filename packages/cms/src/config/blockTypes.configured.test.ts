/** Every block type declares when it is configured (audit 2026-10-18 A3). */
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { BLOCK_CONFIGURED, isBlockConfigured, } from './blockTypes';

describe('BLOCK_CONFIGURED', () => {
    it('has an arm for every catalog block type', () => {
        for (const t of ALL_BLOCK_TYPES) expect(typeof BLOCK_CONFIGURED[t],).toBe('function',);
    },);
    it('keeps the old special cases', () => {
        expect(isBlockConfigured('spacer', {},),).toBe(true,);
        expect(isBlockConfigured('post_list', {},),).toBe(true,);
        expect(isBlockConfigured('template', {},),).toBe(false,);
        expect(isBlockConfigured('template', { templateId: 't', },),).toBe(true,);
        expect(isBlockConfigured('entity', { entity: { templateId: 't', }, },),).toBe(true,);
        expect(isBlockConfigured('social', { provider: 'youtube', },),).toBe(true,);
        expect(isBlockConfigured('gallery', { source: 'items', itemIds: [], },),).toBe(false,);
        expect(isBlockConfigured('gallery', { source: 'query', },),).toBe(true,);
        expect(isBlockConfigured('image', { images: [{ url: 'a.jpg', },], },),).toBe(true,);
        expect(isBlockConfigured('rich_text', {},),).toBe(false,);
    },);
},);
