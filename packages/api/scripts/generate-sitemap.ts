#!/usr/bin/env tsx
/**
 * Standalone sitemap generator. Reuses the same `buildSitemap()` the
 * HTTP route uses, so output never drifts.
 *
 * Usage:
 *   npm run sitemap                       # print to stdout
 *   npm run sitemap -- --out path.xml     # write to file
 *   npm run sitemap -- --out -            # explicit stdout
 *
 * Exit codes:
 *   0 — sitemap generated successfully
 *   1 — generation or DB error
 */
import { writeFileSync, } from 'fs';
import { closePool, } from '../src/db/client';
import { buildSitemap, countSitemapUrls, } from '../src/services/sitemap';

function parseArgs(argv: string[],): { out: string | null; } {
    let out: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--out' || argv[i] === '-o') && argv[i + 1]) {
            out = argv[i + 1] === '-' ? null : argv[i + 1];
            i++;
        }
    }
    return { out, };
}

async function main(): Promise<void> {
    const { out, } = parseArgs(process.argv.slice(2,),);
    try {
        const xml = await buildSitemap();
        const urlCount = countSitemapUrls(xml,);

        if (out === null) {
            // stdout
            process.stdout.write(xml + '\n',);
            process.stderr.write(`✓ ${urlCount} URLs generated (${xml.length} bytes)\n`,);
        } else {
            writeFileSync(out, xml,);
            process.stderr.write(`✓ ${urlCount} URLs → ${out} (${xml.length} bytes)\n`,);
        }
    } catch (err) {
        process.stderr.write(`✗ Sitemap generation failed: ${(err as Error).message}\n`,);
        process.exitCode = 1;
    } finally {
        await closePool();
    }
}

void main();
