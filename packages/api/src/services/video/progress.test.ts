import { describe, expect, it, } from 'vitest';
import { fractionDone, overallProgress, ProgressParser, } from './progress';

describe('ProgressParser', () => {
    it('parses blocks across split chunks', () => {
        const p = new ProgressParser();
        expect(p.feed('frame=10\nout_time_us=1500',),).toEqual([],);
        expect(p.feed('000\nout_time=00:00:01.500000\nprogress=continue\n',),).toEqual([{ outTimeUs: 1_500_000, done: false, },],);
        expect(p.feed('out_time_ms=3000000\r\nprogress=end\n',),).toEqual([{ outTimeUs: 3_000_000, done: true, },],);
    },);
    it('falls back to out_time and ignores N/A', () => {
        const p = new ProgressParser();
        expect(p.feed('out_time_us=N/A\nout_time=00:01:02.250000\nprogress=continue\n',),).toEqual([{ outTimeUs: 62_250_000, done: false, },],);
        expect(p.feed('out_time=-00:00:00.1\nprogress=continue\n',),).toEqual([{ outTimeUs: null, done: false, },],);
    },);
    it('fractionDone clamps', () => {
        expect(fractionDone(5e6, 10e6,),).toBe(0.5,);
        expect(fractionDone(20e6, 10e6,),).toBe(1,);
        expect(fractionDone(null, 10e6,),).toBe(0,);
        expect(fractionDone(5, 0,),).toBe(0,);
    },);
},);

describe('overallProgress', () => {
    const items = [
        { variant: 'full' as const, width: 1920, height: 1080, progress: 0, },
        { variant: 'full' as const, width: 640, height: 360, progress: 100, },
        { variant: 'teaser' as const, width: 640, height: 360, progress: 0, },
    ];
    it('weighs by pixels, with fixed download/finalize slices', () => {
        const p = overallProgress(items, { downloaded: true, finalized: false, },);
        const w1 = 1920 * 1080;
        const w2 = 640 * 360;
        const wt = 0.02 * w2;
        expect(p,).toBeCloseTo(5 + 90 * w2 / (w1 + w2 + wt), 1,);
        expect(overallProgress(items.map((i,) => ({ ...i, progress: 100, })), { downloaded: true, finalized: true, },),).toBe(100,);
        expect(overallProgress([], { downloaded: false, finalized: false, },),).toBe(0,);
    },);
},);
