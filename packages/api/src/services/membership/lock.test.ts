import { describe, expect, it, vi, } from 'vitest';

const clientQuery = vi.fn();
const release = vi.fn();
vi.mock('../../db', () => ({ getClient: async () => ({ query: (...a: unknown[]) => clientQuery(...a), release, }), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

import { withMembershipLock, } from './lock';

describe('withMembershipLock', () => {
    it('runs the work holding the member lock, then unlocks and releases the client', async () => {
        clientQuery.mockReset().mockImplementation(async (sql: string,) => ({ rows: [{ ok: sql.includes('try_advisory',), },], }),);
        release.mockReset();
        expect(await withMembershipLock('u1', async () => 'done',),).toBe('done',);
        const sqls = clientQuery.mock.calls.map(([s,],) => String(s,),);
        expect(sqls[0],).toContain('pg_try_advisory_lock',);
        expect(sqls[1],).toContain('pg_advisory_unlock',);
        expect(clientQuery.mock.calls[0][1],).toEqual(['membership:u1',],);
        expect(release,).toHaveBeenCalledOnce();
    },);

    it('answers 409 at once when another change holds it (double click), without running the work', async () => {
        clientQuery.mockReset().mockResolvedValue({ rows: [{ ok: false, },], },);
        release.mockReset();
        const work = vi.fn();
        await expect(withMembershipLock('u1', work,),).rejects.toThrow(/already in progress/,);
        expect(work,).not.toHaveBeenCalled();
        expect(clientQuery.mock.calls.some(([s,],) => String(s,).includes('advisory_unlock',),),).toBe(false,);
        expect(release,).toHaveBeenCalledOnce();
    },);

    it('unlocks when the work throws', async () => {
        clientQuery.mockReset().mockImplementation(async (sql: string,) => ({ rows: [{ ok: sql.includes('try_advisory',), },], }),);
        await expect(withMembershipLock('u1', async () => { throw new Error('stripe down',); },),).rejects.toThrow('stripe down',);
        expect(clientQuery.mock.calls.some(([s,],) => String(s,).includes('advisory_unlock',),),).toBe(true,);
    },);
},);
