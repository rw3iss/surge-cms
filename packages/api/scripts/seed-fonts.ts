/**
 * Seed the font manager with a handful of free, expressive fonts.
 *
 * Demonstrates how to drive the CMS through the internal SDK from a
 * non-HTTP context (a script, a test, a future plugin). Each font is
 * downloaded from Google Fonts' open CDN, then handed to the SDK's
 * `cms.fonts.create` — same code path the admin upload UI uses, no
 * Express round-trip.
 *
 * Run with:
 *   npm --workspace=backend run seed:fonts
 *   # or:
 *   tsx backend/scripts/seed-fonts.ts
 *
 * Skips fonts whose `customId` is already taken so re-running is
 * safe.
 */
import { closePool, getPool, } from '../src/db/client';
import { logger, } from '../src/utils/logger';
import { cms, } from '../src/sdk';

interface SeedFont {
    customId: string;
    familyName: string;
    /** Direct .woff2 URL from Google Fonts' open CDN. */
    url: string;
    fileName: string;
}

// Hand-picked artistic / casual / display fonts. The .woff2 URLs
// here are from fonts.gstatic.com, served under the same Open Font
// License the rest of Google Fonts uses. We download once, ship the
// bytes through the SDK; the binary then lives on this site.
const SEED_FONTS: SeedFont[] = [
    {
        customId: 'caveat',
        familyName: 'Caveat',
        url: 'https://fonts.gstatic.com/s/caveat/v18/Wnz6HAc5bAfYB2QRah7pcpNvOx-pjfJ9eIWpYTl0qg.woff2',
        fileName: 'Caveat-Regular.woff2',
    },
    {
        customId: 'lobster',
        familyName: 'Lobster',
        url: 'https://fonts.gstatic.com/s/lobster/v30/neILzCirqoswsqX9_oWsMqEzSJQ.woff2',
        fileName: 'Lobster-Regular.woff2',
    },
    {
        customId: 'playfair-display',
        familyName: 'Playfair Display',
        url: 'https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvUDQ.woff2',
        fileName: 'PlayfairDisplay-Regular.woff2',
    },
    {
        customId: 'pacifico',
        familyName: 'Pacifico',
        url: 'https://fonts.gstatic.com/s/pacifico/v22/FwZY7-Qmy14u9lezJ-6H6MmBp0u-.woff2',
        fileName: 'Pacifico-Regular.woff2',
    },
    {
        customId: 'permanent-marker',
        familyName: 'Permanent Marker',
        url: 'https://fonts.gstatic.com/s/permanentmarker/v16/Fh4uPib9Iyv2ucM6pGQMWimMp004La2Cf5b6jlg.woff2',
        fileName: 'PermanentMarker-Regular.woff2',
    },
];

async function fetchBuffer(url: string,): Promise<Buffer> {
    const response = await fetch(url,);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`,);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer,);
}

async function main(): Promise<void> {
    // The SDK reaches into the existing Postgres pool, so we just
    // need the pool to be lazily initialised. Calling getPool() here
    // forces the connection up front so any auth / config error
    // surfaces before we start downloading.
    getPool();
    logger.info('Seeding fonts via cms.fonts SDK...',);

    let added = 0;
    let skipped = 0;
    for (const font of SEED_FONTS) {
        const existing = await cms.fonts.findFontByCustomId(font.customId,);
        if (existing) {
            logger.info(`Skipping ${font.customId} — already present.`,);
            skipped++;
            continue;
        }
        try {
            const buffer = await fetchBuffer(font.url,);
            const created = await cms.fonts.create({
                buffer,
                originalName: font.fileName,
                customId: font.customId,
                familyName: font.familyName,
            },);
            logger.info(`Added ${created.customId} (${created.format}, ${created.sizeBytes} bytes)`,);
            added++;
        } catch (error) {
            logger.error(`Failed to seed ${font.customId}`, { error: (error as Error).message, },);
        }
    }

    logger.info(`Done. Added ${added}, skipped ${skipped}, total ${SEED_FONTS.length}.`,);
}

main()
    .catch((error,) => {
        logger.error('Seed script failed', { error, },);
        process.exitCode = 1;
    },)
    .finally(async () => {
        await closePool();
    },);
