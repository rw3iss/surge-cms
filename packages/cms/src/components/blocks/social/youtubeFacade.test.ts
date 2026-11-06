import { describe, expect, it, } from 'vitest';
import { needsThumbFallback, youtubeEmbedSrc, youtubeFacadeLabel, youtubeFallbackThumb, } from './youtubeFacade';

describe('youtubeFacade', () => {
    const fb = youtubeFallbackThumb('abc',);

    it('builds the hq fallback + encoded embed src', () => {
        expect(fb,).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg',);
        expect(youtubeEmbedSrc('a/b?c',),).toBe('https://www.youtube.com/embed/a%2Fb%3Fc?enablejsapi=1&autoplay=1&playsinline=1',);
    });

    it('falls back on a failed load or the 120px placeholder, never from the fallback itself', () => {
        expect(needsThumbFallback('https://i.ytimg.com/vi/abc/maxresdefault.jpg', fb, null,),).toBe(true,);
        expect(needsThumbFallback('https://i.ytimg.com/vi/abc/maxresdefault.jpg', fb, 120,),).toBe(true,);
        expect(needsThumbFallback('https://i.ytimg.com/vi/abc/maxresdefault.jpg', fb, 1280,),).toBe(false,);
        expect(needsThumbFallback(fb, fb, null,),).toBe(false,);
        expect(needsThumbFallback('', fb, null,),).toBe(false,);
    });

    it('labels with a short title', () => {
        expect(youtubeFacadeLabel(undefined,),).toBe('YouTube video',);
        expect(youtubeFacadeLabel('  Hello\n world ',),).toBe('Hello world',);
        const long = youtubeFacadeLabel('x'.repeat(300,),);
        expect(long.length,).toBe(100,);
        expect(long.endsWith('…',),).toBe(true,);
    });
});
