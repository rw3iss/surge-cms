/**
 * The announcement claims its products BEFORE sending, so two overlapping
 * sends (double click, two admins, the cron racing a manual send) cannot both
 * mail the list; a failed send puts the products back to pending.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
vi.mock('../../db', () => ({ query: (...a: unknown[]) => query(...a), }),);
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./settings', () => ({ getRaw: async () => ({ settings: { newMerchandiseListId: 'L1', currency: 'USD', }, }), }),);
vi.mock('../mail/purposes', () => ({ getPurposeConfig: async () => ({ enabled: true, blocks: [], }), }),);
const send = vi.fn();
vi.mock('../mailSend', () => ({ send: (...a: unknown[]) => send(...a), }),);

const { announce, } = await import('./merchandiseAnnounce');

const PRODUCT = { id: '00000000-0000-0000-0000-0000000000a1', title: 'Tee', slug: 'tee', price_cents: 1000, image_url: null, created_at: new Date('2026-10-01T00:00:00Z',), };
const ctx = { userId: 'u', ipAddress: '', userAgent: '', };

beforeEach(() => {
    query.mockReset();
    send.mockReset();
},);

/** Route the service's queries: the live-products read, the claim, the release. */
function db(claimRows: Array<{ id: string; prev: Date | null; }>,) {
    query.mockImplementation(async (sql: string,) => {
        if (/WITH prev AS/.test(sql,)) return { rows: claimRows, };
        if (/unnest/.test(sql,)) return { rows: [], };
        return { rows: [PRODUCT,], };
    },);
}

describe('announce — claim first', () => {
    it('refuses when another send already claimed the products', async () => {
        db([],);
        await expect(announce({ productIds: [PRODUCT.id,], }, ctx,),).rejects.toThrow(/just announced/,);
        expect(send,).not.toHaveBeenCalled();
    },);

    it('sends once the claim succeeds', async () => {
        db([{ id: PRODUCT.id, prev: null, },],);
        send.mockResolvedValue({ jobId: 'j1', total: 3, },);
        await expect(announce({ productIds: [PRODUCT.id,], }, ctx,),).resolves.toMatchObject({ jobId: 'j1', },);
        expect(send,).toHaveBeenCalledTimes(1,);
    },);

    it('releases the claim when the send fails', async () => {
        db([{ id: PRODUCT.id, prev: null, },],);
        send.mockRejectedValue(new Error('smtp',),);
        await expect(announce({ productIds: [PRODUCT.id,], }, ctx,),).rejects.toThrow('smtp',);
        expect(query.mock.calls.some(([sql,],) => /unnest/.test(String(sql,),),),).toBe(true,);
    },);

    it('the cron claims only never-announced products', async () => {
        db([{ id: PRODUCT.id, prev: null, },],);
        send.mockResolvedValue({ jobId: 'j1', total: 1, },);
        await announce({ productIds: [PRODUCT.id,], }, ctx, { manual: false, },);
        const claim = query.mock.calls.find(([sql,],) => /WITH prev AS/.test(String(sql,),),)!;
        expect((claim[1] as unknown[])[1],).toBe(false,);
    },);
},);
