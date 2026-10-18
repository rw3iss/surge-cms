/** C8: a media status change clears the gallery caches (public reads need status = ready). */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({ set: vi.fn(), inv: vi.fn(), }),);
vi.mock('../../repositories/videoWorker.repo', () => ({ setMediaStatus: m.set, }),);
vi.mock('../cache', () => ({ invalidateGalleryCache: m.inv, }),);

import { setMediaStatus, } from './mediaStatus';

beforeEach(() => { m.set.mockReset(); m.inv.mockReset(); },);

describe('setMediaStatus', () => {
    it('clears the gallery cache when the status changed', async () => {
        m.set.mockResolvedValue(true,);
        await setMediaStatus('m1', 'ready',);
        expect(m.inv,).toHaveBeenCalledOnce();
    });
    it('leaves it alone when nothing changed', async () => {
        m.set.mockResolvedValue(false,);
        await setMediaStatus('m1', 'ready',);
        expect(m.inv,).not.toHaveBeenCalled();
    });
});
