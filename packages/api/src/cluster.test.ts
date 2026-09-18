/**
 * The worker-count parser decides how many copies of the server run, so the
 * failure modes worth pinning are the ones that would be discovered in
 * production: a typo forking zero processes, or `auto` on a big box forking
 * more copies than there are cores to run them.
 */
import { describe, expect, it, vi, } from 'vitest';
import os from 'node:os';
import { resolveClusterWorkers, } from './config/loader';

const cores = () => Math.max(1, os.cpus().length,);

describe('resolveClusterWorkers', () => {
    it('defaults to 1 — unset means the pre-cluster behaviour', () => {
        // Docker images and npm consumers must be unaffected until they opt in.
        expect(resolveClusterWorkers(undefined,),).toBe(1,);
        expect(resolveClusterWorkers('',),).toBe(1,);
    },);

    it('reads an explicit count', () => {
        expect(resolveClusterWorkers('2',),).toBe(Math.min(2, cores(),),);
    },);

    it('maps auto/max to the core count', () => {
        expect(resolveClusterWorkers('auto',),).toBe(cores(),);
        expect(resolveClusterWorkers('MAX',),).toBe(cores(),);
        expect(resolveClusterWorkers(' auto ',),).toBe(cores(),);
    },);

    it('never returns less than 1, whatever the input', () => {
        // A zero or negative value would fork nothing and serve nothing. Falling
        // back to 1 keeps the site up; refusing to boot over a typo would not.
        for (const v of ['0', '-4', 'abc', 'NaN', '1.5.2',]) {
            expect(resolveClusterWorkers(v,), v,).toBeGreaterThanOrEqual(1,);
        }
        expect(resolveClusterWorkers('0',),).toBe(1,);
        expect(resolveClusterWorkers('-4',),).toBe(1,);
        expect(resolveClusterWorkers('abc',),).toBe(1,);
    },);

    it('caps at the core count', () => {
        // Extra workers past the core count only add context switching and
        // memory — each is a full copy of the app.
        expect(resolveClusterWorkers('9999',),).toBe(cores(),);
    },);

    it('reports a single core as 1 rather than 0', () => {
        const spy = vi.spyOn(os, 'cpus',).mockReturnValue([] as unknown as os.CpuInfo[],);
        try {
            // `os.cpus()` returning empty is rare but documented; it must not
            // produce a worker count of 0.
            expect(resolveClusterWorkers('auto',),).toBe(1,);
            expect(resolveClusterWorkers('4',),).toBe(1,);
        } finally {
            spy.mockRestore();
        }
    },);
},);
