import { describe, expect, it, } from 'vitest';
import { avcLevel, codecsFor, encodeOrder, renditionPlan, selectRungs, teaserRungs, } from './ladder';

const LADDER = [
    { name: '1080p', height: 1080, maxrateKbps: 5000, audioKbps: 128, enabled: true, },
    { name: '720p', height: 720, maxrateKbps: 2800, audioKbps: 128, enabled: true, },
    { name: '480p', height: 480, maxrateKbps: 1200, audioKbps: 96, enabled: true, },
    { name: '360p', height: 360, maxrateKbps: 700, audioKbps: 96, enabled: true, },
];

describe('selectRungs', () => {
    it('keeps rungs no taller than the source, with even widths', () => {
        const r = selectRungs(LADDER, 1280, 720, 30,);
        expect(r.map((x,) => x.name),).toEqual(['720p', '480p', '360p',],);
        expect(r.map((x,) => x.width),).toEqual([1280, 854, 640,],);
        expect(r.every((x,) => x.width % 2 === 0 && x.height % 2 === 0),).toBe(true,);
    },);

    it('portrait sources (shorts) size rungs by the short side and keep their aspect', () => {
        const r = selectRungs(LADDER, 1080, 1920, 30,);
        expect(r.map((x,) => x.name),).toEqual(['1080p', '720p', '480p', '360p',],);
        expect([r[0].width, r[0].height,],).toEqual([1080, 1920,],);
        expect([r[1].width, r[1].height,],).toEqual([720, 1280,],);
    },);

    it('a small portrait clip still gets one rung', () => {
        const r = selectRungs(LADDER, 240, 426, 30,);
        expect(r,).toHaveLength(1,);
        expect([r[0].width, r[0].height,],).toEqual([240, 426,],);
    },);

    it('teaser rungs compare the short side', () => {
        const r = selectRungs(LADDER, 1080, 1920, 30,);
        expect(teaserRungs(r, 480,).map((x,) => x.name),).toEqual(['480p', '360p',],);
    },);

    it('a source below the lowest rung gets one rung at its own height', () => {
        const r = selectRungs(LADDER, 320, 241, 25,);
        expect(r,).toHaveLength(1,);
        expect(r[0].name,).toBe('242p',);
        expect(r[0].height,).toBe(242,);
        expect(r[0].maxrateKbps,).toBe(700,);
    },);

    it('skips disabled rungs', () => {
        const r = selectRungs(LADDER.map((x,) => ({ ...x, enabled: x.name !== '720p', })), 1920, 1080, 30,);
        expect(r.map((x,) => x.name),).toEqual(['1080p', '480p', '360p',],);
    },);

    it('bandwidth = (video + audio) × 1.1, codecs carry the level', () => {
        const [top,] = selectRungs(LADDER, 1920, 1080, 30,);
        expect(top.bandwidth,).toBe(Math.round(5128 * 1000 * 1.1,),);
        expect(top.codecs,).toBe('avc1.640028,mp4a.40.2',);
        expect(top.level,).toBe('4.0',);
        expect(top.bufsizeKbps,).toBe(10000,);
    },);
},);

describe('avcLevel', () => {
    it('picks the smallest level that fits', () => {
        expect(avcLevel(640, 360, 30,),).toBe(30,);
        expect(avcLevel(854, 480, 30,),).toBe(31,);
        expect(avcLevel(1280, 720, 30,),).toBe(31,);
        expect(avcLevel(1280, 720, 60,),).toBe(32,);
        expect(avcLevel(1920, 1080, 60,),).toBe(42,);
        expect(codecsFor(31,),).toBe('avc1.64001f,mp4a.40.2',);
    },);
},);

describe('encodeOrder', () => {
    const rungs = selectRungs(LADDER, 1920, 1080, 30,);
    it('fast-first: lowest, then top-down', () => {
        expect(encodeOrder(rungs, 'fast-first',).map((x,) => x.name),).toEqual(['360p', '1080p', '720p', '480p',],);
    },);
    it('top-down', () => {
        expect(encodeOrder(rungs, 'top-down',).map((x,) => x.name),).toEqual(['1080p', '720p', '480p', '360p',],);
    },);
},);

describe('teaserRungs + renditionPlan', () => {
    it('teaser: rungs ≤ max height, at least the lowest', () => {
        const rungs = selectRungs(LADDER, 1920, 1080, 30,);
        expect(teaserRungs(rungs, 720,).map((x,) => x.name),).toEqual(['720p', '480p', '360p',],);
        expect(teaserRungs(rungs, 200,).map((x,) => x.name),).toEqual(['360p',],);
    },);
    it('plans full + teaser rows', () => {
        const rungs = selectRungs(LADDER, 1280, 720, 30,);
        const plan = renditionPlan(rungs, teaserRungs(rungs, 480,),);
        expect(plan.map((p,) => `${p.variant}:${p.name}`),).toEqual(['full:720p', 'full:480p', 'full:360p', 'teaser:480p', 'teaser:360p',],);
        expect(plan[0].sortOrder,).toBe(0,);
    },);
},);
