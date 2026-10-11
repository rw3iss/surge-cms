import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(), }),);

const { GoogleYouTubeOAuthProvider, YOUTUBE_READONLY_SCOPE, } = await import('./google');
const { authRequest, } = await import('../social/youtubeAuth');

describe('Google (YouTube) OAuth', () => {
    const p = new GoogleYouTubeOAuthProvider({ clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://x.test/cb', },);

    it('asks for offline access + consent so Google issues a refresh token', () => {
        const u = new URL(p.getAuthorizationUrl('st8',),);
        expect(u.searchParams.get('access_type',),).toBe('offline',);
        expect(u.searchParams.get('prompt',),).toBe('consent',);
        expect(u.searchParams.get('scope',),).toBe(YOUTUBE_READONLY_SCOPE,);
        expect(u.searchParams.get('state',),).toBe('st8',);
        expect(u.searchParams.get('redirect_uri',),).toBe('https://x.test/cb',);
    },);

    it('authRequest: bearer header when signed in, key param otherwise', () => {
        expect(authRequest({ mode: 'oauth', accessToken: 'tok', channelId: 'UC', },),)
            .toEqual({ query: '', init: { headers: { Authorization: 'Bearer tok', }, }, },);
        expect(authRequest({ mode: 'key', apiKey: 'k y', channelId: 'UC', },).query,).toBe('&key=k%20y',);
    },);
},);
