import { beforeEach, describe, expect, it, vi, } from 'vitest';

const POST = '11111111-1111-1111-1111-111111111111';
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const h = vi.hoisted(() => ({
    post: null as Record<string, unknown> | null,
    written: [] as Record<string, unknown>[],
    shared: new Set<string>(),
    removed: [] as string[],
    blockMedia: [] as string[],
    locked: 0,
}),);

const dbQuery = vi.hoisted(() => vi.fn(async (sql: string, params: unknown[] = [],) => {
        if (sql.includes('SELECT id, post_type')) return { rows: h.post ? [h.post,] : [], };
        if (sql.startsWith('UPDATE posts SET type_settings')) { h.written.push(JSON.parse(params[1] as string,),); return { rows: [], }; }
        if (sql.includes('FROM media WHERE id = ANY')) return { rows: [], };
        if (sql.includes('SELECT media_id FROM live_recordings')) return { rows: [], };
        if (sql.includes("type = 'video'")) return { rows: h.blockMedia.map((m,) => ({ media_id: m, })), };
        if (sql.includes("status = 'recording'")) return { rows: [], };
        return { rows: [], };
    },),);
vi.mock('../db', () => ({
    query: dbQuery,
    // The row-locked transaction runs on the same fake.
    transaction: vi.fn(async (fn: (c: unknown,) => unknown,) => { h.locked += 1; return fn({ query: dbQuery, },); },),
}),);
// The shared "in use" scan: `shared` ids are used by a gallery item; this
// post's own usage is always present (and must be ignored).
vi.mock('./mediaUsage', () => ({
    findMediaUsage: vi.fn(async (ids: string[],) => Object.fromEntries(ids.map((id,) => [id, [
        { kind: 'post', id: POST, label: 'this post', adminUrl: null, field: 'Live recording', },
        ...(h.shared.has(id,) ? [{ kind: 'gallery_item', id: 'g1', label: 'Gallery', adminUrl: null, field: 'Media', },] : []),
    ],]),)),
}),);
vi.mock('./media', () => ({ remove: vi.fn(async (id: string,) => { h.removed.push(id,); },), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: { invalidatePostCache: vi.fn(), }, }),);

import { deleteVersion, purgePostMedia, restartShow, } from './liveReplays';

const ctx = { userId: 'u', } as never;

beforeEach(() => {
    h.written = [];
    h.removed = [];
    h.shared = new Set();
    h.blockMedia = [];
    h.locked = 0;
    h.post = {
        id: POST, post_type: 'live', live_ended_at: '2026-10-09T00:00:00Z',
        type_settings: { recordingMediaId: B, recordingVersions: [{ mediaId: A, recordedAt: 'x', }, { mediaId: B, recordedAt: 'y', },], },
    };
},);

describe('live replays', () => {
    it('deleting the shown version removes its media and marks the replay removed', async () => {
        await deleteVersion(POST, B, ctx,);
        expect(h.removed,).toEqual([B,],);
        expect(h.written[0],).toMatchObject({ recordingMediaId: null, recordingVersions: [{ mediaId: A, },], },);
        expect(h.written[0].recordingRemovedAt,).toBeTruthy();
    },);

    it('deleting an older version keeps the shown replay', async () => {
        await deleteVersion(POST, A, ctx,);
        expect(h.written[0],).not.toHaveProperty('recordingMediaId',);
    },);

    it('restart refuses a show that has not ended', async () => {
        h.post!.live_ended_at = null;
        await expect(restartShow(POST, ctx,),).rejects.toThrow(/not ended/,);
    },);

    it('permanent delete purges every version + Video-block media, but keeps media used elsewhere', async () => {
        h.blockMedia = [C,];
        h.shared.add(A,);
        const r = await purgePostMedia(POST, ctx,);
        expect(r.removed.sort(),).toEqual([B, C,].sort(),);
        expect(r.kept,).toEqual([A,],);
    },);

    it('deleting a version used elsewhere (e.g. the Gallery) only removes it from the post (S6)', async () => {
        h.shared.add(B,);
        await deleteVersion(POST, B, ctx,);
        expect(h.removed,).toEqual([],);
        expect(h.written[0],).toMatchObject({ recordingVersions: [{ mediaId: A, },], },);
    },);

    it('updates the version list inside a row-locked transaction, before removing files (S7)', async () => {
        await deleteVersion(POST, A, ctx,);
        expect(h.locked,).toBe(1,);
        const forUpdate = dbQuery.mock.calls.some(([sql,],) => String(sql,).includes('FOR UPDATE',));
        expect(forUpdate,).toBe(true,);
    },);
},);
