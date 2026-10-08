/**
 * Playback is role-shaped: the full stream's URL must never reach a viewer
 * who may not watch it, and master playlists list only READY renditions.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const media = {
    id: '11111111-1111-1111-1111-111111111111', title: 'Talk', original_name: 'talk.mp4', mime_type: 'video/mp4',
    url: 'x', thumbnail_url: 'https://cdn/t.jpg', status: 'ready', access_level: 'private', width: 1920, height: 1080,
    duration_ms: 600000,
};
vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [media,], }),), }),);
const canMock = vi.fn(async () => false,);
vi.mock('../permissions', () => ({ can: (...a: unknown[]) => canMock(...(a as [])), }),);
vi.mock('../cache', () => ({
    cache: { get: vi.fn(async () => null,), set: vi.fn(async () => undefined,), },
    CACHE_KEYS: { videoMaster: (id: string, v: string,) => `video:master:${id}:${v}`, },
}),);
vi.mock('../storage', () => ({
    resolveStorageProvider: async () => ({ publicUrl: (k: string,) => `https://cdn/${k}`, presignGet: async () => 'signed', }),
    isObjectStore: () => true,
}),);
vi.mock('./settings', () => ({ getVideoSettings: async () => ({ downloadsEnabled: true, }), }),);
vi.mock('./keys', () => ({ keyBytes: async () => Buffer.alloc(16,), }),);
const rend = (variant: string, name: string, height: number, status = 'ready',) => ({
    id: name + variant, variant, name, height, width: Math.round(height * 16 / 9,), status, bandwidth: 1000, avgBandwidth: 800,
    codecs: 'avc1.64001f,mp4a.40.2', playlistPath: `video/x/${variant}/${name}/index.m3u8`, downloadPath: variant === 'full' ? `d/${name}.mp4` : null,
    downloadBytes: 5, progress: 100,
});
vi.mock('../../repositories/video.repo', () => ({
    getVideo: async () => ({ teaserEnabled: true, teaserStartMs: 0, teaserDurationMs: 60000, posterUrl: 'https://cdn/p.jpg', thumbnailsVtt: 'https://cdn/s.vtt', }),
    listRenditions: async (_id: string, variant?: string,) =>
        [rend('full', '1080p', 1080, 'encoding',), rend('full', '480p', 480,), rend('teaser', '480p', 480,),].filter((r,) => !variant || r.variant === variant),
    activeJob: async () => ({ id: 'j', }),
}),);

let play: typeof import('./playback');
beforeEach(async () => {
    canMock.mockReset();
    canMock.mockResolvedValue(false,);
    play = await import('./playback');
},);

describe('playback', () => {
    it('hides the full stream from a viewer without media.private:view', async () => {
        const p = await play.playback(media.id, { id: 'u', role: 'member', },);
        expect(p.src,).toBeNull();
        expect(p.teaserSrc,).toMatch(/teaser\.m3u8$/,);
        expect(p.downloads,).toEqual([],);
        expect(p.thumbnailsVtt,).toBeNull();
        expect(p.access,).toEqual({ full: false, reason: 'private', },);
    },);

    it('gives a permitted viewer the full stream, ready qualities and downloads', async () => {
        canMock.mockResolvedValue(true,);
        const p = await play.playback(media.id, { id: 'u', role: 'admin', },);
        expect(p.src,).toMatch(/master\.m3u8$/,);
        expect(p.qualities,).toEqual(['480p',],);
        expect(p.downloads.map((d,) => d.quality),).toEqual(['480p',],);
    },);

    it('anonymous viewers are never permitted for private video', async () => {
        const p = await play.playback(media.id, null,);
        expect(p.src,).toBeNull();
        expect(canMock,).not.toHaveBeenCalled();
    },);
},);

describe('masterPlaylist', () => {
    it('refuses the private full master without permission', async () => {
        await expect(play.masterPlaylist(media.id, 'full', null,),).rejects.toThrow(/subscribers/,);
    },);

    it('lists only ready renditions, on the CDN, and is never shared-cached for private', async () => {
        canMock.mockResolvedValue(true,);
        const r = await play.masterPlaylist(media.id, 'full', { id: 'u', role: 'admin', },);
        expect(r.body,).toContain('#EXT-X-STREAM-INF:BANDWIDTH=1000,AVERAGE-BANDWIDTH=800,RESOLUTION=853x480',);
        expect(r.body,).toContain('https://cdn/video/x/full/480p/index.m3u8',);
        expect(r.body,).not.toContain('1080p',);
        expect(play.masterCacheControl(r,),).toBe('private, no-store',);
    },);

    it('serves the teaser master to anyone', async () => {
        const r = await play.masterPlaylist(media.id, 'teaser', null,);
        expect(r.body,).toContain('/teaser/480p/index.m3u8',);
        expect(play.masterCacheControl(r,),).toBe('public, max-age=10, s-maxage=10',);
    },);
},);

describe('hlsKey', () => {
    it('is 403 for viewers without the permission', async () => {
        await expect(play.hlsKey(1, { id: 'u', role: 'member', },),).rejects.toThrow(/subscribers/,);
    },);
    it('returns 16 bytes for a permitted viewer', async () => {
        canMock.mockResolvedValue(true,);
        expect((await play.hlsKey(1, { id: 'u', role: 'admin', },)).length,).toBe(16,);
    },);
},);
