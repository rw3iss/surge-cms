/**
 * The backup / media-storage routes must refuse a machine key.
 *
 * `/backup` and `/backup/restore` were hardened deliberately — their comment
 * says "a machine key must not be able to do either". The destination and
 * media-storage routes added later reach the same secrets by another door:
 * a write to `/backup-destination` naming an attacker's bucket, then
 * `POST /backup-destination/run`, uploads a full `pg_dump` there. Every one of
 * them is `auth: 'admin'`, which accepts a scoped `ssk_` key.
 *
 * This asserts the shape of the route table rather than mounting Express: the
 * property is "no route in this family reaches its body without the guard",
 * and that is visible in the source.
 */
import { readFileSync, } from 'node:fs';
import { join, } from 'node:path';
import { describe, expect, it, } from 'vitest';

const SRC = readFileSync(join(__dirname, 'settings.ts',), 'utf8',);

/** Every `defineRoute({...})` block in the module, as source text. */
function routeBlocks(): string[] {
    const out: string[] = [];
    let i = SRC.indexOf('defineRoute({',);
    while (i !== -1) {
        const next = SRC.indexOf('defineRoute({', i + 1,);
        out.push(SRC.slice(i, next === -1 ? SRC.length : next,),);
        i = next;
    }
    return out;
}

/** Routes whose path names the backup or media-storage surface. */
const SENSITIVE = /path: '\/(backup|media-storage)/;

describe('backup + media-storage routes', () => {
    const blocks = routeBlocks().filter(b => SENSITIVE.test(b,));

    it('finds the whole family', () => {
        // If this drops, the sweep below is silently testing nothing.
        expect(blocks.length,).toBeGreaterThanOrEqual(11,);
    });

    it.each(blocks.map(b => [/path: '([^']+)'/.exec(b,)?.[1] ?? '?', b,] as const),)(
        '%s refuses an API key',
        (_path, block,) => {
            // Either the shared guard (which calls rejectKeyAuth) or the
            // original inline pair. Both are acceptable; neither is optional.
            const guarded = block.includes('requireBackupAccess(',) ||
                block.includes('rejectKeyAuth(',);
            expect(guarded,).toBe(true,);
        },
    );

    it.each(blocks.map(b => [/path: '([^']+)'/.exec(b,)?.[1] ?? '?', b,] as const),)(
        '%s names a backup permission',
        (_path, block,) => {
            expect(/settings\.backup:(download|restore)/.test(block,),).toBe(true,);
        },
    );

    it('never passes a raw request where a permission SUBJECT is expected', () => {
        /*
         * `requirePermission` reads `subject.id` / `subject.role`. An Express
         * Request has neither, so `req as never` resolved against an anonymous
         * subject and failed closed — the restore-from-destination route denied
         * everyone, including a sysadmin.
         */
        expect(SRC.includes('requirePermission(req as never',),).toBe(false,);
    });
});
