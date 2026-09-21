/**
 * Backup destinations.
 *
 * The failure modes here are quiet ones: a backup that lands somewhere nobody
 * looks, a retention sweep that deletes a file it did not create, or a
 * destination that accepts a connection but cannot actually be written to —
 * which you discover during the first real backup.
 */
import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile, utimes, } from 'fs/promises';
import { tmpdir, } from 'os';
import { join, } from 'path';

vi.mock('../../utils/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), },
}),);

import { pruneOldBackups, storeBackup, testDestination, } from './destinations';

const cfg = (over: Record<string, unknown> = {},) => ({
    destination: 'local', local: { path: '', }, s3: { bucket: '', },
    retentionDays: 0, ...over,
} as never);

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'bk-test-',),); },);
afterEach(async () => { await rm(dir, { recursive: true, force: true, },); },);

describe('storeBackup — local', () => {
    it('copies the dump into the configured folder', async () => {
        const src = join(dir, 'src.dump',);
        await writeFile(src, 'DUMPDATA',);
        const out = join(dir, 'dest',);
        const r = await storeBackup(cfg({ local: { path: out, }, },), src, 'sitesurge-backup-1.dump',);
        expect(r.location,).toBe(join(out, 'sitesurge-backup-1.dump',),);
        expect(await readdir(out,),).toContain('sitesurge-backup-1.dump',);
    },);

    it('REJECTS a relative path', async () => {
        // A relative path resolves against the process's working directory,
        // which differs between a systemd unit and a shell — the backup would
        // land somewhere nobody thinks to look.
        const src = join(dir, 'src.dump',);
        await writeFile(src, 'x',);
        await expect(storeBackup(cfg({ local: { path: 'backups', }, },), src, 'f.dump',),)
            .rejects.toThrow(/absolute/i,);
    },);

    it('rejects an empty path rather than guessing one', async () => {
        const src = join(dir, 'src.dump',);
        await writeFile(src, 'x',);
        await expect(storeBackup(cfg({ local: { path: '', }, },), src, 'f.dump',),)
            .rejects.toThrow(/configured/i,);
    },);
},);

describe('storeBackup — download', () => {
    it('stores nothing and says so, rather than failing', async () => {
        // "Download only" is a valid choice, not an error.
        const src = join(dir, 'src.dump',);
        await writeFile(src, 'x',);
        const r = await storeBackup(cfg({ destination: 'download', },), src, 'f.dump',);
        expect(r.location,).toMatch(/not stored/i,);
        expect(r.bytes,).toBe(1,);
    },);
},);

describe('testDestination', () => {
    it('passes on a writable folder and leaves nothing behind', async () => {
        const out = join(dir, 'probe',);
        const r = await testDestination(cfg({ local: { path: out, }, },),);
        expect(r.ok,).toBe(true,);
        expect(await readdir(out,),).toHaveLength(0,);
    },);

    it('FAILS on a folder it cannot write to', async () => {
        // The point of the probe: reachability alone would pass for a
        // destination that cannot actually be written, and the failure would
        // then surface during the first real backup. A read-only directory is
        // the local stand-in for a read-only object-store credential.
        const ro = join(dir, 'readonly',);
        await mkdir(ro,);
        await chmod(ro, 0o500,);
        try {
            const r = await testDestination(cfg({ local: { path: ro, }, },),);
            expect(r.ok,).toBe(false,);
        } finally {
            await chmod(ro, 0o700,);
        }
    },);

    it('fails a relative path', async () => {
        expect((await testDestination(cfg({ local: { path: 'rel', }, },),)).ok,).toBe(false,);
    },);

    it('reports missing S3 credentials rather than throwing', async () => {
        const r = await testDestination(cfg({
            destination: 's3', s3: { bucket: 'b', }, },),);
        expect(r.ok,).toBe(false,);
        expect(r.detail,).toMatch(/key/i,);
    },);

    it('treats download-only as nothing to test', async () => {
        expect((await testDestination(cfg({ destination: 'download', },),)).ok,).toBe(true,);
    },);
},);

describe('pruneOldBackups', () => {
    const old = (path: string,) => utimes(path, new Date(0,), new Date(0,),);

    it('removes only files THIS CMS created', async () => {
        // A backup folder or bucket is often shared. Deleting by age alone
        // would eventually remove someone else's file.
        await writeFile(join(dir, 'sitesurge-backup-old.dump',), 'x',);
        await writeFile(join(dir, 'important-customer-data.zip',), 'x',);
        await old(join(dir, 'sitesurge-backup-old.dump',),);
        await old(join(dir, 'important-customer-data.zip',),);

        const removed = await pruneOldBackups(cfg({ local: { path: dir, }, retentionDays: 1, },),);
        expect(removed,).toBe(1,);
        const left = await readdir(dir,);
        expect(left,).toContain('important-customer-data.zip',);
        expect(left,).not.toContain('sitesurge-backup-old.dump',);
    },);

    it('keeps backups inside the retention window', async () => {
        await writeFile(join(dir, 'sitesurge-backup-new.dump',), 'x',);
        const removed = await pruneOldBackups(cfg({ local: { path: dir, }, retentionDays: 30, },),);
        expect(removed,).toBe(0,);
        expect(await readdir(dir,),).toContain('sitesurge-backup-new.dump',);
    },);

    it('retention 0 means keep everything', async () => {
        await writeFile(join(dir, 'sitesurge-backup-ancient.dump',), 'x',);
        await old(join(dir, 'sitesurge-backup-ancient.dump',),);
        expect(await pruneOldBackups(cfg({ local: { path: dir, }, retentionDays: 0, },),),).toBe(0,);
    },);

    it('never throws — a failed sweep must not fail a good backup', async () => {
        await expect(
            pruneOldBackups(cfg({ local: { path: '/nonexistent/xyz', }, retentionDays: 1, },),),
        ).resolves.toBe(0,);
    },);
},);
