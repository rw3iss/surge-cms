import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({
    repo: { getVideo: vi.fn(), requestCancel: vi.fn(), activeJob: vi.fn(), },
    store: { deletePrefix: vi.fn(), deleteObject: vi.fn(), },
    invalidateVideoCache: vi.fn(),
}),);

vi.mock('../../repositories/video.repo', () => m.repo,);
vi.mock('../storage', () => ({ resolveStorageProvider: () => Promise.resolve(m.store,), isObjectStore: () => true, }),);
vi.mock('../cache', () => ({ cache: { invalidateVideoCache: m.invalidateVideoCache, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./playback', () => ({ mediaHead: vi.fn(), }),);
vi.mock('./keys', () => ({ createKey: vi.fn(), retireUnusedKeys: vi.fn(), }),);
vi.mock('./share', () => ({ createShareToken: vi.fn(), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), }, }),);

import { deleteVideoAssets, } from './manage';

beforeEach(() => {
    for (const g of [m.repo, m.store,]) for (const f of Object.values(g,)) f.mockReset();
    m.store.deleteObject.mockResolvedValue(undefined,);
},);

describe('deleteVideoAssets (the cancel/delete path)', () => {
    it('flags the job cancelled, waits for the encoder to stop, then deletes every object', async () => {
        m.repo.getVideo.mockResolvedValue({ sourceKey: 'incoming/s/clip.mp4', },);
        m.repo.requestCancel.mockResolvedValue({ id: 'j1', },);
        m.repo.activeJob.mockResolvedValueOnce({ id: 'j1', },).mockResolvedValue(null,);
        await deleteVideoAssets('m1',);
        expect(m.repo.requestCancel,).toHaveBeenCalledWith('m1',);
        expect(m.repo.activeJob,).toHaveBeenCalledTimes(2,);
        expect(m.store.deletePrefix,).toHaveBeenCalledWith(expect.stringContaining('m1',),);
        expect(m.store.deletePrefix,).toHaveBeenCalledWith('originals/m1/',);
        expect(m.store.deleteObject,).toHaveBeenCalledWith('incoming/s/clip.mp4',);
        // The flag is set BEFORE storage is touched.
        expect(m.repo.requestCancel.mock.invocationCallOrder[0],).toBeLessThan(m.store.deletePrefix.mock.invocationCallOrder[0]!,);
        expect(m.invalidateVideoCache,).toHaveBeenCalledWith('m1',);
    },);

    it('never throws on a storage failure', async () => {
        m.repo.getVideo.mockResolvedValue({ sourceKey: null, },);
        m.repo.activeJob.mockResolvedValue(null,);
        m.store.deletePrefix.mockRejectedValue(new Error('boom',),);
        await expect(deleteVideoAssets('m1',),).resolves.toBeUndefined();
    },);
},);
