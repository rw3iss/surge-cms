/** A2: the encode planner — resume from READY rows, teaser, sprites once; the disk budget. */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);

const { diskNeedBytes, planRungs, } = await import('./pipeline');

const rungs = [{ name: '360p', }, { name: '720p', }, { name: '1080p', },];

describe('planRungs', () => {
    it('resume after rung 2: only the rungs not READY encode', () => {
        const st: Record<string, string> = { 'full:360p': 'ready', 'full:720p': 'ready', 'full:1080p': 'queued', };
        const plan = planRungs({ rungs, status: (k,) => st[k], teaser: false, spritesDone: true, },);
        expect(plan.map((p,) => [p.rung.name, p.encode,]),).toEqual([['360p', false,], ['720p', false,], ['1080p', true,],],);
        expect(plan.every((p,) => !p.teaser && !p.sprites,),).toBe(true,);
    });
    it('teaser rows not ready are cut; ready / absent ones are not', () => {
        const st: Record<string, string> = { 'teaser:360p': 'ready', 'teaser:720p': 'queued', };
        const plan = planRungs({ rungs, status: (k,) => st[k], teaser: true, spritesDone: true, },);
        expect(plan.map((p,) => p.teaser),).toEqual([false, true, false,],);
        // No teaser prefix → never.
        expect(planRungs({ rungs, status: (k,) => st[k], teaser: false, spritesDone: true, },).some((p,) => p.teaser,),).toBe(false,);
    });
    it('sprites: once, from the first rung in order, unless already built', () => {
        expect(planRungs({ rungs, status: () => undefined, teaser: false, spritesDone: false, },).map((p,) => p.sprites),).toEqual([true, false, false,],);
        expect(planRungs({ rungs, status: () => undefined, teaser: false, spritesDone: true, },).some((p,) => p.sprites,),).toBe(false,);
    });
});

describe('diskNeedBytes', () => {
    const ladder = [{ maxrateKbps: 5000, audioKbps: 128, },];
    it('never probed: the source size stands in for a rung', () => {
        expect(diskNeedBytes({ sourceBytes: 1e9, haveBytes: 0, priorDurationMs: 0, ladder, minFreeDiskGb: 2, },),).toBe(1e9 + 2e9 + 2e9,);
    });
    it('a partial download counts; the rung is estimated from the prior duration', () => {
        const need = diskNeedBytes({ sourceBytes: 1e9, haveBytes: 4e8, priorDurationMs: 60_000, ladder, minFreeDiskGb: 0, },);
        expect(need,).toBeCloseTo(6e8 + 2 * (5128 * 125 * 60 * 1.3), 0,);
    });
});
