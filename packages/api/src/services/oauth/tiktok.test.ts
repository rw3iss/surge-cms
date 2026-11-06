import { describe, expect, it, vi, } from 'vitest';
import {
    businessAuthorizeUrl,
    businessTokenCredentials,
    displayTokenCredentials,
    parseBusinessToken,
    parseTikTokToken,
    TIKTOK_BUSINESS_SCOPES,
    TikTokBusinessOAuthProvider,
    TikTokOAuthProvider,
} from './tiktok';
import { getOAuthProvider, oauthAppCredentials, oauthConnection, } from './index';

describe('TikTok Login Kit OAuth', () => {
    const p = new TikTokOAuthProvider({ appId: 'ck', appSecret: 'cs', redirectUri: 'https://x.test/cb', },);

    it('builds the v2 authorize URL with client_key + comma scopes', () => {
        const u = new URL(p.getAuthorizationUrl('st8',),);
        expect(u.origin + u.pathname,).toBe('https://www.tiktok.com/v2/auth/authorize/',);
        expect(u.searchParams.get('client_key',),).toBe('ck',);
        expect(u.searchParams.get('scope',),).toBe('user.info.basic,user.info.profile,user.info.stats,video.list',);
        expect(u.searchParams.get('response_type',),).toBe('code',);
        expect(u.searchParams.get('redirect_uri',),).toBe('https://x.test/cb',);
        expect(u.searchParams.get('state',),).toBe('st8',);
    },);

    it('parses the token answer and stores the expiries', () => {
        const t = parseTikTokToken({
            access_token: 'act.1', expires_in: 86400, open_id: 'o', refresh_expires_in: 31536000, refresh_token: 'rft.1', scope: 'user.info.basic,video.list', token_type: 'Bearer',
        },);
        expect(t,).toEqual({ accessToken: 'act.1', refreshToken: 'rft.1', expiresIn: 86400, refreshExpiresIn: 31536000, openId: 'o', scope: 'user.info.basic,video.list', },);
        const c = displayTokenCredentials(t, Date.UTC(2026, 0, 1,),);
        expect(c,).toMatchObject({ accessToken: 'act.1', refreshToken: 'rft.1', openId: 'o', scope: 'user.info.basic,video.list', oauthError: null, },);
        expect(c.tokenExpiresAt,).toBe('2026-01-02T00:00:00.000Z',);
        expect(c.refreshTokenExpiresAt,).toBe('2027-01-01T00:00:00.000Z',);
        expect(() => parseTikTokToken({ error: 'invalid_request', error_description: 'Redirect_uri is not matched', },),).toThrow(/Redirect_uri/,);
    },);

    it('exchanges the code form-encoded with the redirect_uri', async () => {
        const spy = vi.spyOn(globalThis, 'fetch',).mockResolvedValue(new Response(JSON.stringify({ access_token: 'a', expires_in: 7200, },),),);
        const r = await p.exchangeCode('code1',);
        const [url, init,] = spy.mock.calls[0]!;
        expect(String(url,),).toBe('https://open.tiktokapis.com/v2/oauth/token/',);
        const body = new URLSearchParams(String(init?.body,),);
        expect(Object.fromEntries(body,),).toEqual({ client_key: 'ck', client_secret: 'cs', code: 'code1', grant_type: 'authorization_code', redirect_uri: 'https://x.test/cb', },);
        expect(p.tokenCredentials(r,).accessToken,).toBe('a',);
        spy.mockRestore();
    },);
},);

describe('TikTok Business (Accounts API) OAuth', () => {
    it('uses the pasted account-holder URL (state set, its redirect kept) or builds one', () => {
        const pasted = 'https://www.tiktok.com/v2/auth/authorize?client_key=APP&scope=user.insights&response_type=code&redirect_uri=https%3A%2F%2Fmine.test%2Fcb';
        const u = new URL(businessAuthorizeUrl('APP', 'https://x.test/cb', 'st', pasted,),);
        expect(u.searchParams.get('state',),).toBe('st',);
        expect(u.searchParams.get('redirect_uri',),).toBe('https://mine.test/cb',);
        const built = new URL(businessAuthorizeUrl('APP', 'https://x.test/cb', 'st', null,),);
        expect(built.searchParams.get('client_key',),).toBe('APP',);
        expect(built.searchParams.get('scope',),).toBe(TIKTOK_BUSINESS_SCOPES.join(',',),);
    },);

    it('parses { code, data } answers and stores business* credentials', () => {
        const t = parseBusinessToken({
            code: 0, message: 'OK', data: { access_token: 'b1', expires_in: 86400, refresh_token: 'br', refresh_token_expires_in: 31536000, open_id: 'biz', scope: 'user.insights', token_type: 'Bearer', },
        },);
        const c = businessTokenCredentials(t, Date.UTC(2026, 0, 1,),);
        expect(c,).toMatchObject({ businessAccessToken: 'b1', businessRefreshToken: 'br', businessId: 'biz', businessScope: 'user.insights', businessOauthError: null, },);
        expect(c.businessTokenExpiresAt,).toBe('2026-01-02T00:00:00.000Z',);
        expect(() => parseBusinessToken({ code: 40104, message: 'auth_code is invalid', data: {}, },),).toThrow(/auth_code/,);
    },);

    it('exchanges auth_code as JSON at tt_user/oauth2/token', async () => {
        const p = new TikTokBusinessOAuthProvider({ appId: 'A', appSecret: 'S', redirectUri: 'https://x.test/cb', },);
        const spy = vi.spyOn(globalThis, 'fetch',).mockResolvedValue(new Response(JSON.stringify({ code: 0, data: { access_token: 'b', open_id: 'o', }, },),),);
        await p.exchangeCode('ac',);
        const [url, init,] = spy.mock.calls[0]!;
        expect(String(url,),).toBe('https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/',);
        expect(JSON.parse(String(init?.body,),),).toEqual({ client_id: 'A', client_secret: 'S', grant_type: 'authorization_code', auth_code: 'ac', redirect_uri: 'https://x.test/cb', },);
        spy.mockRestore();
    },);

    it('registry: tiktok_business stores on the tiktok row with its own app credentials', () => {
        expect(oauthConnection('tiktok_business',),).toBe('tiktok',);
        expect(oauthConnection('instagram',),).toBe('instagram',);
        expect(oauthAppCredentials('tiktok_business', { appId: 'ck', appSecret: 'cs', },),).toBeNull();
        expect(oauthAppCredentials('tiktok_business', { businessAppId: 'A', businessAppSecret: 'S', },),).toEqual({ appId: 'A', appSecret: 'S', },);
        const p = getOAuthProvider('tiktok_business', { businessAppId: 'A', businessAppSecret: 'S', }, 'https://x.test/cb',);
        expect(p.secondary,).toBe(true,);
        expect(new URL(p.getAuthorizationUrl('s',),).searchParams.get('client_key',),).toBe('A',);
    },);
},);
