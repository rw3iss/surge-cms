/**
 * Guard: every build-time stylesheet must sit inside a cascade layer.
 *
 * WHY THIS TEST EXISTS: unlayered CSS outranks EVERY layer, regardless of
 * specificity. Block styles are emitted at runtime into `block` / `block-bp`, so
 * a single stylesheet that escapes the `@layer theme` wrap silently beats all
 * block styling — and gives no visual clue as to the cause. That failure is
 * near-impossible to spot by eye and trivial to catch here.
 *
 * Runs against the BUILT css in `packages/cms/dist/assets`. When there is no
 * build present the test skips rather than fails, so a plain `vitest` run on a
 * clean checkout stays green; CI builds before testing.
 */
import { describe, expect, it, } from 'vitest';
import { existsSync, readdirSync, readFileSync, } from 'node:fs';
import { join, } from 'node:path';

const DIST = join(__dirname, '../../dist/assets',);

/** Strip comments and string/url literals so braces can be counted naively. */
function stripNoise(css: string,): string {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, '',)
        .replace(/"(?:[^"\\]|\\.)*"/g, '""',)
        .replace(/'(?:[^'\\]|\\.)*'/g, "''",);
}

/**
 * Top-level chunks of a stylesheet: at depth 0, everything up to and including
 * each balanced `{ … }` block, plus any trailing statement at-rules.
 */
function topLevelChunks(css: string,): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                out.push(css.slice(start, i + 1,).trim(),);
                start = i + 1;
            }
        } else if (c === ';' && depth === 0) {
            out.push(css.slice(start, i + 1,).trim(),);
            start = i + 1;
        }
    }
    const tail = css.slice(start,).trim();
    if (tail) out.push(tail,);
    return out.filter(Boolean,);
}

/** At-rules allowed to sit outside a layer — they cannot live inside one, or
 *  carry no declarations that could win the cascade. */
const ALLOWED_UNLAYERED = /^@(charset|import|namespace|layer\b)/i;

describe('cascade layers', () => {
    const files = existsSync(DIST,)
        ? readdirSync(DIST,).filter((f,) => f.endsWith('.css',))
        : [];

    it.skipIf(files.length === 0,)('every built stylesheet is wrapped in @layer', () => {
        const offenders: string[] = [];

        for (const file of files) {
            const css = stripNoise(readFileSync(join(DIST, file,), 'utf8',),);
            for (const chunk of topLevelChunks(css,)) {
                if (ALLOWED_UNLAYERED.test(chunk,)) continue;
                // Report the selector, not the whole rule — a 100 KB bundle in
                // the failure message helps nobody.
                offenders.push(`${file}: ${chunk.slice(0, 120,)}`,);
            }
        }

        expect(
            offenders,
            `Unlayered CSS outranks every @layer, so these rules silently beat all block styles.\n`
                + `Ensure config/cms/postcss.config.mjs wraps them:\n  ${offenders.slice(0, 10,).join('\n  ',)}`,
        ).toEqual([],);
    },);

    it.skipIf(files.length === 0,)('the theme layer is actually populated', () => {
        // A wrap that produced empty layers would pass the check above while
        // leaving the theme unstyled.
        const withTheme = files.filter((f,) =>
            readFileSync(join(DIST, f,), 'utf8',).includes('@layer theme',)
        );
        expect(withTheme.length,).toBeGreaterThan(0,);
    },);
},);
