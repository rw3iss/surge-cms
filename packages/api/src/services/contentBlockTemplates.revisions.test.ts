/** Template / component saves are versioned like mail templates (audit G1). */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const markDirty = vi.fn();
const cancelPending = vi.fn();
vi.mock('./revisions', () => ({ markDirty: (...a: unknown[]) => markDirty(...a,), cancelPending: (...a: unknown[]) => cancelPending(...a,), }),);
vi.mock('./cache', () => ({
    cache: { invalidateContentBlockTemplatesCache: vi.fn(), invalidateContentBlockTemplatesGlobalCache: vi.fn(), },
    CACHE_KEYS: {},
}),);
vi.mock('../db', () => ({ query: vi.fn(), }),);
vi.mock('../entities/entityManager', () => ({ getType: () => ({}), }),);
vi.mock('../repositories/contentBlockTemplates.repo', () => ({
    update: vi.fn(async (id: string,) => ({ id, entityTypeKey: null, })),
    saveWithBlocks: vi.fn(async (id: string | null,) => ({ id: id ?? 'new', entityTypeKey: 'post', })),
    replaceBlocks: vi.fn(),
    findById: vi.fn(async (id: string,) => ({ id, entityTypeKey: null, })),
    remove: vi.fn(),
}),);

import * as svc from './contentBlockTemplates';
import { BLOCK_STORES, } from './blockStores';

beforeEach(() => vi.clearAllMocks());

describe('content-block template revisions', () => {
    it('is a registered block store', () => {
        expect(BLOCK_STORES.content_block_template,).toMatchObject({ table: 'content_block_template_blocks', fk: 'template_id', },);
    },);

    it('marks the template dirty on every write path, with the author', async () => {
        await svc.update('t1', { name: 'x', }, 'u1',);
        await svc.saveWithBlocks(null, { name: 'y', }, [], 'u1',);
        await svc.replaceBlocks('t2', [], 'u1',);
        expect(markDirty.mock.calls,).toEqual([
            ['content_block_template', 't1', 'u1',],
            ['content_block_template', 'new', 'u1',],
            ['content_block_template', 't2', 'u1',],
        ],);
    },);

    it('drops a pending snapshot on delete', async () => {
        await svc.remove('t3',);
        expect(cancelPending,).toHaveBeenCalledWith('content_block_template', 't3',);
    },);
},);
