/**
 * Every media route must check `media:read` / `media:write` (S1), not only the
 * bulk ones — otherwise revoking `media:write` from editors in Settings →
 * Permissions still lets them upload, rename and delete one item at a time.
 * The guard itself (API keys pass on their scope, people are checked) is
 * tested below with the permission manager mocked.
 */
import { readFileSync, } from 'node:fs';
import { join, } from 'node:path';
import { describe, expect, it, vi, } from 'vitest';

const canMock = vi.fn(async () => false,);
vi.mock('../services/permissions', () => ({
    requirePermission: async (s: unknown, k: string,) => {
        if (!(await canMock(s as never, k as never,))) throw Object.assign(new Error('forbidden',), { statusCode: 403, },);
    },
}),);

function blocks(file: string,): string[] {
    const src = readFileSync(join(__dirname, file,), 'utf8',);
    const out: string[] = [];
    let i = src.indexOf('defineRoute({',);
    while (i !== -1) {
        const next = src.indexOf('defineRoute({', i + 1,);
        out.push(src.slice(i, next === -1 ? src.length : next,),);
        i = next;
    }
    return out;
}

describe('media routes (S1)', () => {
    const all = blocks('media.ts',);
    it('finds every route', () => expect(all.length,).toBeGreaterThanOrEqual(11,));
    it.each(all.map((b,) => [/method: '(\w+)', path: '([^']+)'/.exec(b,)?.slice(1,).join(' ',) ?? '?', b,] as const),)(
        '%s checks a media permission',
        (name, block,) => {
            const write = !name.startsWith('get',);
            expect(block,).toContain(`guardMedia(ctx, '${write ? 'media:write' : 'media:read'}'`,);
        },
    );
});

describe('video management reads (S1)', () => {
    const all = blocks('video.ts',).filter((b,) => /path: '\/(jobs|status|settings|:id)'/.test(b,) && /method: 'get'/.test(b,));
    it.each(all.map((b,) => [/path: '([^']+)'/.exec(b,)?.[1] ?? '?', b,] as const),)('%s checks media:read', (_p, block,) => {
        expect(block,).toMatch(/needRead\(ctx,\)/,);
    });
});

describe('guardMedia', () => {
    it('denies a person without media:write (DELETE /media/:id path)', async () => {
        const { guardMedia, } = await import('./media');
        canMock.mockResolvedValueOnce(false,);
        await expect(guardMedia({ user: { id: 'u', role: 'editor', }, }, 'media:write',),).rejects.toThrow();
    });
    it('allows a person with the permission', async () => {
        const { guardMedia, } = await import('./media');
        canMock.mockResolvedValueOnce(true,);
        await expect(guardMedia({ user: { id: 'u', role: 'editor', }, }, 'media:write',),).resolves.toBeUndefined();
    });
    it('lets a scoped API key through (scope already checked)', async () => {
        const { guardMedia, } = await import('./media');
        canMock.mockClear();
        await guardMedia({ apiKey: { name: 'k', }, }, 'media:write',);
        expect(canMock,).not.toHaveBeenCalled();
    });
});
