import { describe, expect, it, } from 'vitest';
import { expectedPartBytes, MAX_PARTS, MIB, MIN_PART_SIZE, planParts, } from './uploadMath';

const GIB = 1024 * MIB;

describe('planParts', () => {
    it('20 GiB at 64 MiB → 320 parts', () => {
        expect(planParts(20 * GIB, 64,),).toEqual({ partSize: 64 * MIB, partCount: 320, },);
    },);

    it('a tiny file is one part', () => {
        expect(planParts(1234, 64,).partCount,).toBe(1,);
    },);

    it('a file exactly one part long is one part', () => {
        expect(planParts(64 * MIB, 64,).partCount,).toBe(1,);
    },);

    it('raises the part size so the count stays ≤ 10,000', () => {
        const size = 1000 * GIB;
        const p = planParts(size, 8,);
        expect(p.partCount,).toBeLessThanOrEqual(MAX_PARTS,);
        expect(p.partSize % MIB,).toBe(0,);
        expect(p.partSize * p.partCount,).toBeGreaterThanOrEqual(size,);
    },);

    it('never goes below 5 MiB', () => {
        expect(planParts(100 * MIB, 1,).partSize,).toBe(MIN_PART_SIZE,);
    },);

    it('rejects a non-positive size', () => {
        expect(() => planParts(0, 64,)).toThrow();
    },);

    it('the last part carries the remainder', () => {
        const size = 64 * MIB * 2 + 10;
        const p = planParts(size, 64,);
        expect(p.partCount,).toBe(3,);
        expect(expectedPartBytes(size, p, 3,),).toBe(10,);
        expect(expectedPartBytes(size, p, 1,),).toBe(64 * MIB,);
    },);
},);
