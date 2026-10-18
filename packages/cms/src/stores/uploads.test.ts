/** C3: `whenComplete` resolves with the media even when the upload finished first. */
import { describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({ resolveStart: null as null | ((v: unknown,) => void), }),);

vi.mock('../services/cmsClient', () => ({ cms: {}, }),);
vi.mock('./siteSettings', () => ({ isFeatureEnabled: () => true, }),);
vi.mock('../services/upload/multipartUploader', () => ({
    forgetUpload: vi.fn(),
    looksLikeSameFile: vi.fn(),
    readStoredUploads: () => [],
    MultipartUpload: class {
        sessionId = 's1';
        file: { size: number; };
        constructor(file: { size: number; },) { this.file = file; }
        start() { return new Promise((r,) => { m.resolveStart = r; },); }
    },
}),);

const { startUpload, whenComplete, } = await import('./uploads');

describe('whenComplete', () => {
    it('resolves with the media when called after the upload already finished', async () => {
        const id = startUpload({ name: 'a.mp4', size: 10, type: 'video/mp4', } as File,);
        const media = { id: 'm1', status: 'ready', };
        m.resolveStart!(media,);
        await new Promise((r,) => setTimeout(r, 0,),);
        await expect(whenComplete(id,),).resolves.toEqual(media,);
    });

    it('a waiter registered before completion gets the media too', async () => {
        const id = startUpload({ name: 'b.mp4', size: 10, type: 'video/mp4', } as File,);
        const p = whenComplete(id,);
        m.resolveStart!({ id: 'm2', status: 'ready', },);
        await expect(p,).resolves.toMatchObject({ id: 'm2', },);
    });

    it('unknown row → null', async () => {
        await expect(whenComplete('nope',),).resolves.toBeNull();
    });
});
