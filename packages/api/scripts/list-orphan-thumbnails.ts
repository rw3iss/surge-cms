/**
 * List (and with --delete, remove) thumbnail objects no media row points at.
 *
 * Before 2026-10-18 a media delete removed only `thumb_<file>` and
 * `thumb_v2_<file>`, so the `thumb_v3_*` thumbnails written by
 * `scripts/rebuild-thumbnails.ts` were left in the bucket for every media item
 * deleted afterwards. This finds them — and any other `uploads/thumb_*` object
 * that is not some row's CURRENT `thumbnail_url` (old v1/v2 keys a rebuild
 * replaced included).
 *
 *   tsx scripts/list-orphan-thumbnails.ts            # list only
 *   tsx scripts/list-orphan-thumbnails.ts --delete   # delete them
 */
import 'dotenv/config';
import { closePool, query, } from '../src/db/client';
import { isObjectStore, resolveStorageProvider, } from '../src/services/storage';

const DELETE = process.argv.includes('--delete',);

async function main(): Promise<void> {
    const store = await resolveStorageProvider();
    if (!isObjectStore(store,)) {
        console.log('Local storage: not supported by this script.',);
        return;
    }
    const base = store.publicUrl('',);
    const rows = (await query<{ thumbnail_url: string; }>(`SELECT thumbnail_url FROM media WHERE thumbnail_url IS NOT NULL`,)).rows;
    const live = new Set(rows.map((r,) => (r.thumbnail_url.startsWith(base,) ? r.thumbnail_url.slice(base.length,).split('?',)[0] : '')).filter(Boolean,),);
    const objects = await store.listPrefix('uploads/thumb_',);
    const orphans = objects.filter((o,) => !live.has(o.key,),);
    const bytes = orphans.reduce((n, o,) => n + o.size, 0,);
    for (const o of orphans) console.log(`${DELETE ? 'delete' : 'orphan'} ${o.key} (${o.size} B)`,);
    console.log(`${orphans.length} orphaned of ${objects.length} thumbnail object(s), ${(bytes / 1024 / 1024).toFixed(1,)} MB.`,);
    if (!DELETE) return;
    for (const o of orphans) await store.deleteObject(o.key,);
    console.log(`Deleted ${orphans.length}.`,);
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
