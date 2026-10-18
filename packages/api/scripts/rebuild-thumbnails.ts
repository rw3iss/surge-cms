/**
 * Rebuild EVERY image thumbnail with the current settings (services/media.ts
 * createThumbnail: THUMBNAIL_WIDTH, sharpening, mozjpeg). Use after changing
 * those settings — e.g. 2026-10-18: 300px/q80 → 600px/q84 + sharpen, because
 * the old ones looked blurry on retina gallery tiles.
 *
 * Each new thumbnail goes to a NEW key (`uploads/thumb_v3_<file>`) and the row
 * points at it: uploads are served `immutable`, so overwriting the old key would
 * keep the old version in CDN + browser caches for a year. Old objects stay
 * (cheap; a deleted media item still purges by its own row).
 *
 *   tsx scripts/rebuild-thumbnails.ts            # dry run
 *   tsx scripts/rebuild-thumbnails.ts --apply    # do it
 */
import 'dotenv/config';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { closePool, query, } from '../src/db/client';
import { createThumbnail, } from '../src/services/media';
import { IMMUTABLE_CACHE, isObjectStore, resolveStorageProvider, } from '../src/services/storage';

const APPLY = process.argv.includes('--apply',);
const PREFIX = 'thumb_v3_';

async function main(): Promise<void> {
    const store = await resolveStorageProvider();
    if (!isObjectStore(store,)) {
        console.log('Local storage: not supported by this script (thumbnails are rebuilt on re-upload).',);
        return;
    }
    const rows = (await query<{ id: string; filename: string; url: string; }>(
        `SELECT id, filename, url FROM media
          WHERE mime_type LIKE 'image/%' AND mime_type NOT LIKE '%gif%' AND mime_type NOT LIKE '%svg%'
            AND (thumbnail_url IS NULL OR thumbnail_url NOT LIKE '%/${PREFIX}%')
          ORDER BY created_at`,
    )).rows;
    console.log(`${rows.length} image(s); ${APPLY ? 'applying' : 'dry run'}.`,);
    if (!APPLY) return;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'thumbs-',),);
    let done = 0, failed = 0;
    for (const r of rows) {
        try {
            const res = await fetch(new URL(r.url, process.env.SITE_URL || 'https://surgemedia.us',),);
            if (!res.ok) { console.log(`skip ${r.filename}: HTTP ${res.status}`,); failed++; continue; }
            const src = path.join(tmp, `src_${r.filename}`,);
            await fs.writeFile(src, Buffer.from(await res.arrayBuffer(),),);
            const out = path.join(tmp, `out_${r.filename}`,);
            const mime = await createThumbnail(src, out,);
            const base = r.filename.replace(/\.[^.]+$/, '',);
            const key = `uploads/${PREFIX}${base}.${mime === 'image/png' ? 'png' : 'jpg'}`;
            await store.putFile(key, out, { contentType: mime, cacheControl: IMMUTABLE_CACHE, },);
            await query(`UPDATE media SET thumbnail_url = $2, updated_at = NOW() WHERE id = $1`, [r.id, store.publicUrl(key,),],);
            await fs.rm(src, { force: true, },);
            await fs.rm(out, { force: true, },);
            done++;
            if (done % 10 === 0) console.log(`${done} done…`,);
        } catch (e) {
            console.log(`error ${r.filename}: ${(e as Error).message}`,);
            failed++;
        }
    }
    await fs.rm(tmp, { recursive: true, force: true, },);
    console.log(`Rebuilt ${done}, skipped ${failed}.`,);
    if (done) {
        const { invalidateMediaConsumersCache, } = await import('../src/services/cache');
        await invalidateMediaConsumersCache();
    }
}

main().catch((e,) => { console.error(e,); process.exitCode = 1; },).finally(async () => { await closePool(); process.exit(); },);
