import { beforeEach, describe, expect, it, vi, } from 'vitest';

const { repoMock, storeMock, clientQuery, registerVideoMock, } = vi.hoisted(() => {
    const repoMock = {
    insertSession: vi.fn(),
    findOpenByFingerprint: vi.fn(),
    listOpenByUser: vi.fn(),
    findById: vi.fn(),
    setStatus: vi.fn(),
    setMediaId: vi.fn(),
    markCompleted: vi.fn(),
    listExpired: vi.fn(),
};
    const storeMock = {
    createMultipart: vi.fn(),
    presignPart: vi.fn(),
    listParts: vi.fn(),
    completeMultipart: vi.fn(),
    abortMultipart: vi.fn(),
    head: vi.fn(),
    copyObject: vi.fn(),
    deleteObject: vi.fn(),
    publicUrl: vi.fn((k: string,) => `https://cdn.test/${k}`,),
};
    const clientQuery = vi.fn();
    const registerVideoMock = vi.fn();
    return { repoMock, storeMock, clientQuery, registerVideoMock, };
},);

vi.mock('../../repositories/uploadSessions.repo', () => repoMock,);
vi.mock('../storage', () => ({
    resolveStorageProvider: () => Promise.resolve(storeMock,),
    isObjectStore: (p: unknown,) => p === storeMock,
    IMMUTABLE_CACHE: 'public, max-age=31536000, immutable',
}),);
vi.mock('../../db', () => ({
    query: vi.fn(),
    transaction: (cb: (c: unknown,) => Promise<unknown>,) => cb({ query: clientQuery, },),
}),);
vi.mock('../audit', () => ({ logAudit: vi.fn(() => Promise.resolve(),), }),);
vi.mock('./settings', () => ({ getVideoSettings: () => Promise.resolve({ maxUploadGb: 20, partSizeMb: 64, },), }),);
vi.mock('./register', () => ({
    isVideoMime: (m: string,) => m.startsWith('video/',),
    registerVideo: (...a: unknown[]) => registerVideoMock(...a,),
}),);
vi.mock('./paths', () => ({
    incomingKey: (sid: string, f: string,) => `incoming/${sid}/${f}`,
    fileUrl: (id: string,) => `https://site.test/api/v1/video/${id}/file`,
}),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), }, }),);

import * as uploads from './uploads';

const USER = '11111111-1111-4111-8111-111111111111';
const ctx = { userId: USER, };
const MIB = 1024 * 1024;

function row(over: Record<string, unknown> = {},) {
    return {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: USER, filename: 'clip.mp4', mime_type: 'video/mp4',
        size: String(130 * MIB,), fingerprint: 'fp', object_key: 'incoming/a/clip.mp4', upload_id: 'up1',
        part_size: String(64 * MIB,), part_count: 3, status: 'uploading', options: {}, media_id: null,
        created_at: new Date('2026-10-01T00:00:00Z',), updated_at: new Date(), expires_at: new Date(Date.now() + 86400_000,),
        ...over,
    };
}
const part = (n: number, size: number,) => ({ partNumber: n, etag: `e${n}`, size, });
const allParts = () => [part(1, 64 * MIB,), part(2, 64 * MIB,), part(3, 2 * MIB,),];

beforeEach(() => {
    for (const f of [...Object.values(repoMock,), ...Object.values(storeMock,),]) f.mockReset();
    storeMock.publicUrl.mockImplementation((k: string,) => `https://cdn.test/${k}`,);
    clientQuery.mockReset();
    registerVideoMock.mockReset();
},);

const body = { filename: 'clip.mp4', mimeType: 'video/mp4', size: 130 * MIB, fingerprint: 'fp', };

describe('createOrResume', () => {
    it('resumes an open session with its listed parts', async () => {
        repoMock.findOpenByFingerprint.mockResolvedValue(row(),);
        storeMock.listParts.mockResolvedValue([part(1, 64 * MIB,),],);
        const s = await uploads.createOrResume(USER, body, ctx,);
        expect(storeMock.createMultipart,).not.toHaveBeenCalled();
        expect(s.uploadedParts,).toEqual([1,],);
        expect(s.uploadedBytes,).toBe(64 * MIB,);
        expect(s.size,).toBe(130 * MIB,);
    },);

    it('creates a new session with a planned part layout', async () => {
        repoMock.findOpenByFingerprint.mockResolvedValue(null,);
        storeMock.createMultipart.mockResolvedValue('up9',);
        repoMock.insertSession.mockImplementation((i: Record<string, unknown>,) => Promise.resolve(row({
            id: i.id, object_key: i.objectKey, upload_id: i.uploadId, part_count: i.partCount,
        },),),);
        const s = await uploads.createOrResume(USER, body, ctx,);
        const input = repoMock.insertSession.mock.calls[0]![0];
        expect(input.partCount,).toBe(3,);
        expect(input.partSize,).toBe(64 * MIB,);
        expect(input.objectKey,).toBe(`incoming/${input.id}/clip.mp4`,);
        expect(s.uploadedParts,).toEqual([],);
    },);

    it('hashes an over-long fingerprint instead of rejecting it', async () => {
        repoMock.findOpenByFingerprint.mockResolvedValue(null,);
        storeMock.createMultipart.mockResolvedValue('up9',);
        repoMock.insertSession.mockImplementation((i: Record<string, unknown>,) => Promise.resolve(row({
            id: i.id, object_key: i.objectKey, upload_id: i.uploadId, part_count: i.partCount, fingerprint: i.fingerprint,
        },),),);
        const long = `${'x'.repeat(200,)}.mp4:118397324:1789868216148:${'a'.repeat(64,)}`;
        await uploads.createOrResume(USER, { ...body, fingerprint: long, }, ctx,);
        expect(repoMock.insertSession.mock.calls.at(-1)![0].fingerprint,).toMatch(/^[0-9a-f]{64}$/,);
    },);

    it('rejects a file over the upload limit', async () => {
        await expect(uploads.createOrResume(USER, { ...body, size: 21 * 1024 * 1024 * MIB, }, ctx,),).rejects.toThrow(/upload limit/,);
    },);

    it('rejects bad options', async () => {
        await expect(uploads.createOrResume(USER, { ...body, options: { teaserSeconds: 2, }, }, ctx,),).rejects.toThrow(/options/,);
        await expect(uploads.createOrResume(USER, { ...body, options: { accessLevel: 'secret' as never, }, }, ctx,),).rejects.toThrow(/options/,);
    },);
},);

describe('partUrls', () => {
    it('refuses an out-of-range part number', async () => {
        repoMock.findById.mockResolvedValue(row(),);
        await expect(uploads.partUrls(USER, 'x', [4,],),).rejects.toThrow(/out of range/,);
    },);

    it('hides another user\'s session', async () => {
        repoMock.findById.mockResolvedValue(row({ user_id: '22222222-2222-4222-8222-222222222222', },),);
        await expect(uploads.partUrls(USER, 'x', [1,],),).rejects.toThrow(/not found/,);
    },);
},);

describe('complete', () => {
    it('rejects missing parts', async () => {
        repoMock.findById.mockResolvedValue(row(),);
        storeMock.listParts.mockResolvedValue([part(1, 64 * MIB,), part(3, 2 * MIB,),],);
        await expect(uploads.complete(USER, 'x', ctx,),).rejects.toThrow(/missing/,);
        expect(storeMock.completeMultipart,).not.toHaveBeenCalled();
    },);

    it('rejects a size mismatch and aborts', async () => {
        repoMock.findById.mockResolvedValue(row(),);
        storeMock.listParts.mockResolvedValue(allParts(),);
        storeMock.head.mockResolvedValue({ size: 1, },);
        await expect(uploads.complete(USER, 'x', ctx,),).rejects.toThrow(/does not match/,);
        expect(storeMock.deleteObject,).toHaveBeenCalledWith('incoming/a/clip.mp4',);
        expect(repoMock.setStatus,).toHaveBeenCalledWith(expect.any(String,), 'aborted',);
    },);

    it('creates a processing media row and registers the video', async () => {
        repoMock.findById.mockResolvedValue(row({ options: { accessLevel: 'private', title: 'T', }, },),);
        storeMock.listParts.mockResolvedValue(allParts(),);
        storeMock.head.mockResolvedValue({ size: 130 * MIB, },);
        repoMock.markCompleted.mockResolvedValue(true,);
        clientQuery.mockImplementation((_sql: string, p: unknown[],) => Promise.resolve({
            rows: [{ id: p[0], filename: p[1], mime_type: p[3], size: String(p[4],), url: p[5], status: p[11], access_level: p[12], },],
        },),);
        const m = await uploads.complete(USER, 'x', ctx,);
        expect(storeMock.completeMultipart,).toHaveBeenCalledWith('incoming/a/clip.mp4', 'up1', allParts(),);
        expect(m.size,).toBe(130 * MIB,);
        expect((m as unknown as { status: string; }).status,).toBe('processing',);
        expect(m.url,).toContain('/file',);
        expect(registerVideoMock.mock.calls[0]![0],).toMatchObject({ sourceKey: 'incoming/a/clip.mp4', accessLevel: 'private', },);
        expect(storeMock.copyObject,).not.toHaveBeenCalled();
    },);

    it('moves a non-video into uploads/ and marks it ready', async () => {
        repoMock.findById.mockResolvedValue(row({ mime_type: 'application/pdf', filename: 'Big.PDF', },),);
        storeMock.listParts.mockResolvedValue(allParts(),);
        storeMock.head.mockResolvedValue({ size: 130 * MIB, },);
        repoMock.markCompleted.mockResolvedValue(true,);
        clientQuery.mockImplementation((_sql: string, p: unknown[],) => Promise.resolve({
            rows: [{ id: p[0], filename: p[1], size: String(p[4],), url: p[5], status: p[11], },],
        },),);
        const m = await uploads.complete(USER, 'x', ctx,);
        const dest = storeMock.copyObject.mock.calls[0]![1] as string;
        expect(dest,).toMatch(/^uploads\/[\w-]{12}\.pdf$/,);
        expect(m.url,).toBe(`https://cdn.test/${dest}`,);
        expect(registerVideoMock,).not.toHaveBeenCalled();
        expect(storeMock.deleteObject,).toHaveBeenCalledWith('incoming/a/clip.mp4',);
    },);
},);

describe('sweepExpiredUploadSessions', () => {
    it('aborts and expires stale sessions', async () => {
        repoMock.listExpired.mockResolvedValue([row(), row({ id: 'b', },),],);
        storeMock.abortMultipart.mockRejectedValueOnce(new Error('NoSuchUpload',),);
        expect(await uploads.sweepExpiredUploadSessions(),).toBe(2,);
        expect(repoMock.setStatus,).toHaveBeenCalledTimes(2,);
    },);
},);
