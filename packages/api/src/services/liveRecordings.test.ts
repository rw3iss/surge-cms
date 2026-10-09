import { beforeEach, describe, expect, it, vi, } from 'vitest';

const POST_ID = '11111111-1111-4111-8111-111111111111';
const REC_ID = '22222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => ({
    repo: {
        insert: vi.fn(), findById: vi.fn(), findOpen: vi.fn(), findLatest: vi.fn(), transition: vi.fn(), listStale: vi.fn(),
    },
    store: {
        createMultipart: vi.fn(), presignPart: vi.fn(), listParts: vi.fn(), completeMultipart: vi.fn(),
        abortMultipart: vi.fn(), head: vi.fn(), publicUrl: vi.fn((k: string,) => `https://cdn.test/${k}`,),
    },
    clientQuery: vi.fn(),
    registerVideo: vi.fn(),
    loadLivePost: vi.fn(),
    videoOn: { value: true, },
    settings: { live: { provider: 'cloudflare_stream', providers: { cloudflare_stream: { recordingMethod: 'browser', }, }, }, },
    invalidatePostCache: vi.fn(),
}),);

vi.mock('../repositories/liveRecordings.repo', () => m.repo,);
vi.mock('./storage', () => ({
    resolveStorageProvider: () => Promise.resolve(m.store,),
    isObjectStore: (p: unknown,) => p === m.store,
}),);
vi.mock('../db', () => ({
    query: vi.fn(),
    transaction: (cb: (c: unknown,) => Promise<unknown>,) => cb({ query: m.clientQuery, },),
}),);
vi.mock('./audit', () => ({ logAudit: vi.fn(() => Promise.resolve(),), }),);
vi.mock('./cron', () => ({ cronRegistry: { register: vi.fn(), }, }),);
vi.mock('./cache', () => ({ cache: { invalidatePostCache: m.invalidatePostCache, invalidateMediaConsumersCache: vi.fn(), }, }),);
vi.mock('./settings', () => ({ isFeatureEnabledServer: () => Promise.resolve(m.videoOn.value,), }),);
vi.mock('./postSettings', () => ({ getPostsSettings: () => Promise.resolve(m.settings,), }),);
vi.mock('./video/register', () => ({ registerVideo: m.registerVideo, }),);
vi.mock('./video/paths', () => ({ fileUrl: (id: string,) => `https://site.test/api/v1/media/${id}/file`, }),);
vi.mock('./liveRooms/state', () => ({
    loadLivePost: m.loadLivePost,
    isLivePost: () => true,
    effectiveStatus: (r: { liveEndedAt?: unknown; liveStatus?: string; },) => (r.liveEndedAt ? 'ended' : r.liveStatus ?? 'idle'),
}),);

import * as svc from './liveRecordings';

const CTX = { userId: '33333333-3333-4333-8333-333333333333', };
const show = (over: Record<string, unknown> = {},) => ({
    id: POST_ID, slug: 'my-show', title: 'My show', postType: 'live', typeSettings: {}, liveStatus: 'live', liveEndedAt: null,
    requiredTierId: null, ...over,
});
const row = (over: Record<string, unknown> = {},) => ({
    id: REC_ID, post_id: POST_ID, user_id: CTX.userId, method: 'browser', status: 'recording',
    mime_type: 'video/webm;codecs=vp9,opus', object_key: `incoming/live/${POST_ID}/${REC_ID}.webm`, upload_id: 'up1',
    part_size: String(svc.LIVE_PART_SIZE,), media_id: null, error: null,
    created_at: new Date('2026-10-09T00:00:00Z',), updated_at: new Date('2026-10-09T00:00:00Z',), ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    m.videoOn.value = true;
    m.settings.live.providers.cloudflare_stream.recordingMethod = 'browser';
    m.loadLivePost.mockResolvedValue(show(),);
    m.repo.findOpen.mockResolvedValue(null,);
},);

describe('start', () => {
    it('creates a multipart upload with the 8 MiB part size and a live key', async () => {
        m.store.createMultipart.mockResolvedValue('up1',);
        m.repo.insert.mockImplementation((i: Record<string, unknown>,) => Promise.resolve(row({ id: i.id, object_key: i.objectKey, },),),);
        const r = await svc.start(POST_ID, 'video/webm;codecs=vp9,opus', { id: CTX.userId, }, CTX,);
        expect(r.partSize,).toBe(8 * 1024 * 1024,);
        const [key, ctype,] = m.store.createMultipart.mock.calls[0]!;
        expect(key,).toMatch(new RegExp(`^incoming/live/${POST_ID}/[0-9a-f-]{36}\\.webm$`,),);
        expect(ctype,).toBe('video/webm',);
    },);

    it('resumes the open recording with its uploaded parts', async () => {
        m.repo.findOpen.mockResolvedValue(row(),);
        m.store.listParts.mockResolvedValue([{ partNumber: 2, etag: 'b', size: 10, }, { partNumber: 1, etag: 'a', size: 8, },],);
        const r = await svc.start(POST_ID, 'video/webm', undefined, CTX,);
        expect(r.uploadedParts,).toEqual([1, 2,],);
        expect(r.uploadedBytes,).toBe(18,);
        expect(m.store.createMultipart,).not.toHaveBeenCalled();
    },);

    it('refuses ended shows, bad mime types, and the server / none methods', async () => {
        await expect(svc.start(POST_ID, 'text/plain', undefined, CTX,),).rejects.toThrow(/mimeType/,);
        m.loadLivePost.mockResolvedValueOnce(show({ liveEndedAt: new Date(), },),);
        await expect(svc.start(POST_ID, 'video/webm', undefined, CTX,),).rejects.toThrow(/ended/,);
        m.settings.live.providers.cloudflare_stream.recordingMethod = 'server';
        await expect(svc.start(POST_ID, 'video/webm', undefined, CTX,),).rejects.toThrow(/not available yet/,);
        m.settings.live.providers.cloudflare_stream.recordingMethod = 'none';
        await expect(svc.start(POST_ID, 'video/webm', undefined, CTX,),).rejects.toThrow(/turned off/,);
    },);
},);

describe('partUrl', () => {
    it('presigns parts 1..10000 only', async () => {
        m.repo.findById.mockResolvedValue(row(),);
        m.store.presignPart.mockResolvedValue('https://r2.test/put',);
        expect(await svc.partUrl(POST_ID, REC_ID, 1,),).toEqual({ url: 'https://r2.test/put', expiresIn: 3600, },);
        expect(await svc.partUrl(POST_ID, REC_ID, 10_000,),).toMatchObject({ expiresIn: 3600, },);
        await expect(svc.partUrl(POST_ID, REC_ID, 0,),).rejects.toThrow(/partNumber/,);
        await expect(svc.partUrl(POST_ID, REC_ID, 10_001,),).rejects.toThrow(/partNumber/,);
        await expect(svc.partUrl(POST_ID, REC_ID, 1.5,),).rejects.toThrow(/partNumber/,);
    },);

    it('hides a recording that belongs to another post', async () => {
        m.repo.findById.mockResolvedValue(row({ post_id: 'other', },),);
        await expect(svc.partUrl(POST_ID, REC_ID, 1,),).rejects.toThrow(/not found/,);
    },);
},);

describe('complete', () => {
    beforeEach(() => {
        m.repo.findById.mockResolvedValue(row(),);
        m.repo.transition.mockImplementation((_id: string, _from: string, to: string, extra: { mediaId?: string; } = {},) =>
            Promise.resolve(row({ status: to, media_id: extra.mediaId ?? null, },),)
        );
        m.store.listParts.mockResolvedValue([{ partNumber: 1, etag: 'a', size: 8, }, { partNumber: 2, etag: 'b', size: 3, },],);
        m.store.head.mockResolvedValue({ size: 11, },);
        m.clientQuery.mockImplementation((sql: string, params: unknown[],) =>
            Promise.resolve({ rows: sql.includes('INSERT INTO media',) ? [{ id: params[0], title: params[6], },] : [], },)
        );
    },);

    it('assembles parts, creates a processing video media row, registers the encode and sets recordingMediaId', async () => {
        const r = await svc.complete(POST_ID, REC_ID, CTX,);
        expect(r.status,).toBe('completed',);
        expect(m.store.completeMultipart,).toHaveBeenCalledWith(row().object_key, 'up1', expect.arrayContaining([expect.objectContaining({ partNumber: 1, },),],),);
        const insert = m.clientQuery.mock.calls.find((c,) => String(c[0],).includes('INSERT INTO media',),)!;
        const params = insert[1] as unknown[];
        expect(params[3],).toBe('video/webm',);
        expect(params[4],).toBe(11,);
        expect(params[6],).toBe('My show — live recording',);
        expect(params[8],).toBe('processing',);
        expect(params[9],).toBe('public',);
        expect(m.registerVideo,).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: row().object_key, sourceSize: 11, accessLevel: 'public', },), expect.anything(),);
        const upd = m.clientQuery.mock.calls.find((c,) => String(c[0],).includes('UPDATE posts',),)!;
        // A new VERSION is appended and becomes the shown replay.
        expect(String(upd[0],),).toContain('recordingVersions',);
        expect(upd[1],).toEqual([POST_ID, params[0], row().id,],);
        expect(m.registerVideo,).toHaveBeenCalledWith(expect.objectContaining({ quickReplay: true, },), expect.anything(),);
        expect(m.invalidatePostCache,).toHaveBeenCalledWith(POST_ID,);
    },);

    it('marks the media private when the show requires a tier', async () => {
        m.loadLivePost.mockResolvedValue(show({ requiredTierId: 'tier', },),);
        await svc.complete(POST_ID, REC_ID, CTX,);
        const params = m.clientQuery.mock.calls.find((c,) => String(c[0],).includes('INSERT INTO media',),)![1] as unknown[];
        expect(params[9],).toBe('private',);
    },);

    it('stores a plain file when the video feature is off', async () => {
        m.videoOn.value = false;
        await svc.complete(POST_ID, REC_ID, CTX,);
        const params = m.clientQuery.mock.calls.find((c,) => String(c[0],).includes('INSERT INTO media',),)![1] as unknown[];
        expect(params[5],).toBe(`https://cdn.test/${row().object_key}`,);
        expect(params[8],).toBe('ready',);
        expect(m.registerVideo,).not.toHaveBeenCalled();
    },);

    it('requires at least one part and stays retryable', async () => {
        m.store.listParts.mockResolvedValue([],);
        await expect(svc.complete(POST_ID, REC_ID, CTX,),).rejects.toThrow(/no parts/,);
        expect(m.repo.transition,).toHaveBeenLastCalledWith(REC_ID, 'finalizing', 'recording',);
        expect(m.store.completeMultipart,).not.toHaveBeenCalled();
    },);
},);

describe('abort + safety net', () => {
    it('abort aborts the multipart upload', async () => {
        m.repo.findById.mockResolvedValue(row(),);
        await svc.abort(POST_ID, REC_ID, CTX,);
        expect(m.store.abortMultipart,).toHaveBeenCalledWith(row().object_key, 'up1',);
        expect(m.repo.transition,).toHaveBeenCalledWith(REC_ID, 'recording', 'aborted',);
    },);

    it('autoFinalize aborts an empty recording', async () => {
        m.store.listParts.mockResolvedValue([],);
        expect(await svc.autoFinalize(row() as never,),).toBe('aborted',);
    },);

    it('scheduleAutoFinalize is idempotent per show', () => {
        vi.useFakeTimers();
        try {
            svc.scheduleAutoFinalize(POST_ID,);
            svc.scheduleAutoFinalize(POST_ID,);
            expect(vi.getTimerCount(),).toBe(1,);
        } finally {
            svc._clearTimers();
            vi.useRealTimers();
        }
    },);
},);
