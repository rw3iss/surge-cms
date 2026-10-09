import { describe, expect, it, vi, } from 'vitest';

vi.mock('../cmsClient', () => ({ cms: {}, }),);

import { leftoverSkip, nextPartNumber, recordingBitrate, } from './browserRecorder';
import { PartSlicer, } from './partSlicer';

const blob = (n: number, fill = 'a',) => new Blob([fill.repeat(n,),],);
const text = (b: Blob,) => b.text();

describe('PartSlicer', () => {
    it('holds data until a full part is available', () => {
        const s = new PartSlicer(10,);
        expect(s.push(blob(4,),),).toEqual([],);
        expect(s.push(blob(5,),),).toEqual([],);
        expect(s.pendingBytes,).toBe(9,);
    });

    it('cuts parts of EXACTLY partSize and keeps the remainder', async () => {
        const s = new PartSlicer(10,);
        s.push(blob(7, 'a',),);
        const parts = s.push(blob(6, 'b',),);
        expect(parts.map((p,) => p.size),).toEqual([10,],);
        expect(await text(parts[0],),).toBe('aaaaaaabbb',);
        expect(s.pendingBytes,).toBe(3,);
        const last = s.flush();
        expect(await text(last!,),).toBe('bbb',);
        expect(s.pendingBytes,).toBe(0,);
        expect(s.flush(),).toBeNull();
    });

    it('emits several parts from one large chunk, preserving byte order', async () => {
        const s = new PartSlicer(4,);
        const parts = s.push(new Blob(['0123456789ABCD',],),);
        expect(parts.map((p,) => p.size),).toEqual([4, 4, 4,],);
        expect(await Promise.all(parts.map(text,),),).toEqual(['0123', '4567', '89AB',],);
        expect(await text(s.flush()!,),).toBe('CD',);
    });

    it('every part but the last is partSize across many random chunks', async () => {
        const s = new PartSlicer(97,);
        const all: Blob[] = [];
        let total = 0;
        for (let i = 0; i < 200; i++) {
            const n = (i * 37) % 61 + 1;
            total += n;
            all.push(...s.push(blob(n,),),);
        }
        const tail = s.flush();
        expect(all.every((p,) => p.size === 97),).toBe(true,);
        expect(tail!.size,).toBeLessThan(97,);
        expect(all.length * 97 + tail!.size,).toBe(total,);
    });

    it('ignores empty chunks and rejects a bad part size', () => {
        const s = new PartSlicer(5,);
        expect(s.push(new Blob([],),),).toEqual([],);
        expect(() => new PartSlicer(0,),).toThrow();
    });
});

describe('resume bookkeeping', () => {
    it('continues part numbers after the highest uploaded part', () => {
        expect(nextPartNumber([],),).toBe(1,);
        expect(nextPartNumber([1, 3, 2,],),).toBe(4,);
    });

    it('skips whole parts the server has but the local record missed', () => {
        expect(leftoverSkip([1, 2, 3,], 3, 100,),).toBe(0,);
        expect(leftoverSkip([1, 2, 3, 4,], 2, 100,),).toBe(200,);
        expect(leftoverSkip([], 0, 100,),).toBe(0,);
    });

    it('picks a higher bitrate for larger cameras', () => {
        expect(recordingBitrate(1080,),).toBe(8_000_000,);
        expect(recordingBitrate(720,),).toBe(5_000_000,);
        expect(recordingBitrate(480,),).toBe(2_500_000,);
    });
});
