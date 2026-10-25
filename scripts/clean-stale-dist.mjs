#!/usr/bin/env node
/**
 * Delete compiled files in <pkg>/dist whose source in <pkg>/src no longer exists.
 *
 * `tsc` never deletes outputs, so a source file that was moved or split (e.g.
 * services/membership.ts → services/membership/index.ts) left its old
 * dist/services/membership.js behind — and Node resolves `./membership` to the
 * FILE before the directory, so production kept running the old code (2026-10).
 * Not a full `rm -rf dist`: the running server lazily imports from dist while a
 * deploy builds, so only orphans are removed.
 *
 * Usage (from a package dir): node ../../scripts/clean-stale-dist.mjs [dist] [src] [--keep=dir,dir]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2,);
const keep = (args.find((a,) => a.startsWith('--keep=',),)?.slice(7,) ?? '').split(',',).filter(Boolean,);
const [distDir = 'dist', srcDir = 'src',] = args.filter((a,) => !a.startsWith('--',),);
if (!fs.existsSync(distDir,)) process.exit(0,);

const SRC_EXT = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.jsx',];
const OUT = /\.(d\.ts|d\.ts\.map|js\.map|js|mjs)$/;
let removed = 0;

const walk = (dir,) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true, },)) {
        const full = path.join(dir, e.name,);
        const rel = path.relative(distDir, full,);
        if (keep.some((k,) => rel === k || rel.startsWith(`${k}${path.sep}`,),)) continue;
        if (e.isDirectory()) { walk(full,); continue; }
        if (!OUT.test(e.name,)) continue;
        const base = path.join(srcDir, rel.replace(OUT, '',),);
        if (SRC_EXT.some((x,) => fs.existsSync(base + x,),)) continue;
        fs.rmSync(full,);
        removed++;
        console.log(`removed stale ${full}`,);
    }
};
walk(distDir,);
if (removed) console.log(`clean-stale-dist: ${removed} stale file(s) removed from ${distDir}`,);
