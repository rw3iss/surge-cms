/**
 * Fill in `media.width` / `media.height` for images that have none.
 *
 * Uploads did not record image sizes until 2026-10-18, so every older image
 * had none — the gallery masonry then placed items as if they were square and
 * email galleries had no Outlook sizes. New uploads record them
 * (services/media.ts imageDimensions); this fixes the existing rows.
 * Reads each original (EXIF orientation applied) and writes only the two
 * columns — no file is changed.
 *
 *   tsx scripts/backfill-media-dimensions.ts            # dry run
 *   tsx scripts/backfill-media-dimensions.ts --apply    # write
 */
import 'dotenv/config';
import sharp from 'sharp';
import { closePool, query, } from '../src/db/client';

const APPLY = process.argv.includes('--apply',);

async function main(): Promise<void> {
    const rows = (await query<{ id: string; filename: string; url: string; }>(
        `SELECT id, filename, url FROM media
          WHERE mime_type LIKE 'image/%' AND mime_type <> 'image/svg+xml'
            AND (width IS NULL OR height IS NULL)
          ORDER BY created_at`,
    )).rows;
    console.log(`${rows.length} image(s) without a size; ${APPLY ? 'applying' : 'dry run'}.`,);
    let done = 0, failed = 0;
    for (const r of rows) {
        try {
            const res = await fetch(new URL(r.url, process.env.SITE_URL || 'https://surgemedia.us',),);
            if (!res.ok) { console.log(`skip ${r.filename}: HTTP ${res.status}`,); failed++; continue; }
            const m = await sharp(Buffer.from(await res.arrayBuffer(),),).metadata();
            if (!m.width || !m.height) { console.log(`skip ${r.filename}: no size in file`,); failed++; continue; }
            const rotated = (m.orientation ?? 1) >= 5;
            const [w, h,] = rotated ? [m.height, m.width,] : [m.width, m.height,];
            if (APPLY) await query(`UPDATE media SET width = $2, height = $3 WHERE id = $1`, [r.id, w, h,],);
            console.log(`${APPLY ? 'set' : 'would set'} ${r.filename}: ${w}×${h}`,);
            done++;
        } catch (e) {
            console.log(`error ${r.filename}: ${(e as Error).message}`,);
            failed++;
        }
    }
    console.log(`${done} ${APPLY ? 'updated' : 'to update'}, ${failed} skipped.`,);
    if (APPLY && done) {
        // Sizes are copied into cached gallery / post payloads (this also clears the gallery cache).
        const { invalidateMediaConsumersCache, } = await import('../src/services/cache');
        await invalidateMediaConsumersCache();
    }
}

main().catch((e,) => { console.error(e); process.exitCode = 1; },).finally(() => closePool());
