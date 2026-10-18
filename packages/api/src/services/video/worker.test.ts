import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({
    repo: { finishJob: vi.fn(), releaseJob: vi.fn(), blockJob: vi.fn(), failAttempt: vi.fn(), },
    wrepo: { mediaExists: vi.fn(), resetInFlightRenditions: vi.fn(), hasReadyFull: vi.fn(), setMediaStatus: vi.fn(), },
    store: { deletePrefix: vi.fn(), },
    removeJobDir: vi.fn(),
    invalidateVideoCache: vi.fn(),
    invalidateGalleryCache: vi.fn(),
}),);

vi.mock('../../repositories/video.repo', () => m.repo,);
vi.mock('../../repositories/videoWorker.repo', () => m.wrepo,);
vi.mock('../storage', () => ({ resolveStorageProvider: () => Promise.resolve(m.store,), isObjectStore: () => true, }),);
vi.mock('../cache', () => ({ invalidateVideoCache: m.invalidateVideoCache, invalidateGalleryCache: m.invalidateGalleryCache, }),);
vi.mock('../settings', () => ({ isFeatureEnabledServer: () => Promise.resolve(true,), }),);
vi.mock('./tooling', () => ({ encoderEnabled: () => true, }),);
vi.mock('./repackage', () => ({ runRepackageJob: vi.fn(), }),);
vi.mock('./paths', () => ({ mediaVideoRoot: (id: string,) => `video/${id}/`, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./pipeline', async () => {
    const actual = await vi.importActual<typeof import('./pipeline')>('./pipeline',);
    return { ...actual, removeJobDir: m.removeJobDir, runEncodeJob: vi.fn(), };
},);

import { JobAbortedError, JobControl, } from './pipeline';
import { onError, } from './worker';

const job = { id: 'j1', mediaId: 'm1', attempts: 1, } as never;

beforeEach(() => {
    for (const g of [m.repo, m.wrepo, m.store,]) for (const f of Object.values(g,)) f.mockReset();
    m.removeJobDir.mockReset();
    m.invalidateVideoCache.mockReset();
},);

describe('worker onError — cancel', () => {
    it('a cancelled job whose media still exists finishes "cancelled"', async () => {
        const ctl = new JobControl();
        ctl.abort('cancel',);
        m.wrepo.mediaExists.mockResolvedValue(true,);
        m.wrepo.hasReadyFull.mockResolvedValue(false,);
        await onError(job, ctl, new JobAbortedError('cancel',),);
        expect(m.repo.finishJob,).toHaveBeenCalledWith('j1', 'cancelled',);
        expect(m.removeJobDir,).toHaveBeenCalledWith('j1',);
        expect(m.wrepo.setMediaStatus,).toHaveBeenCalledWith('m1', 'failed',);
        expect(m.store.deletePrefix,).not.toHaveBeenCalled();
    },);

    it('a cancel whose media was deleted (discard) purges storage again', async () => {
        const ctl = new JobControl();
        ctl.abort('cancel',);
        m.wrepo.mediaExists.mockResolvedValue(false,);
        await onError(job, ctl, new JobAbortedError('cancel',),);
        expect(m.store.deletePrefix,).toHaveBeenCalledWith('video/m1/',);
        expect(m.store.deletePrefix,).toHaveBeenCalledWith('originals/m1/',);
        expect(m.removeJobDir,).toHaveBeenCalledWith('j1',);
        expect(m.repo.finishJob,).not.toHaveBeenCalled();
    },);

    it('a lost lease because the media (and its job row) was deleted also purges', async () => {
        const ctl = new JobControl();
        ctl.abort('lease',);
        m.wrepo.mediaExists.mockResolvedValue(false,);
        await onError(job, ctl, new JobAbortedError('lease',),);
        expect(m.store.deletePrefix,).toHaveBeenCalledWith('video/m1/',);
    },);

    it('a lost lease with the media still there walks away (another process owns it)', async () => {
        const ctl = new JobControl();
        ctl.abort('lease',);
        m.wrepo.mediaExists.mockResolvedValue(true,);
        await onError(job, ctl, new JobAbortedError('lease',),);
        expect(m.store.deletePrefix,).not.toHaveBeenCalled();
        expect(m.repo.finishJob,).not.toHaveBeenCalled();
        expect(m.removeJobDir,).not.toHaveBeenCalled();
    },);
},);
