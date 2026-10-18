import { describe, expect, it, vi, } from 'vitest';

let held = false;
const release = vi.fn();
const clientQuery = vi.fn(async (sql: string,) => {
    if (/pg_try_advisory_lock/.test(sql,)) {
        if (held) return { rows: [{ ok: false, },], };
        held = true;
        return { rows: [{ ok: true, },], };
    }
    if (/pg_advisory_unlock/.test(sql,)) held = false;
    return { rows: [], };
},);
vi.mock('../../db', () => ({ getClient: async () => ({ query: clientQuery, release, }), }),);
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }),);

const { withPrintifySyncLock, } = await import('./syncLock');

describe('withPrintifySyncLock', () => {
    it('runs, then lets the next caller in', async () => {
        await expect(withPrintifySyncLock(async () => 1,),).resolves.toEqual({ ran: true, value: 1, },);
        await expect(withPrintifySyncLock(async () => 2,),).resolves.toEqual({ ran: true, value: 2, },);
    },);

    it('a second caller while the first runs is refused, and the lock is released after an error', async () => {
        let inner: unknown;
        await withPrintifySyncLock(async () => {
            inner = await withPrintifySyncLock(async () => 'nested',);
        },);
        expect(inner,).toEqual({ ran: false, },);
        await expect(withPrintifySyncLock(async () => { throw new Error('boom',); },),).rejects.toThrow('boom',);
        expect(held,).toBe(false,);
        expect(release,).toHaveBeenCalled();
    },);
},);
