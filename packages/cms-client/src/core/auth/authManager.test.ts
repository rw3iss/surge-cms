import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { AuthManager, } from './authManager';
import type { AuthTokens, TokenStore, } from '../types';

function memStore(initial: AuthTokens | null = null,): TokenStore {
    let v = initial;
    return { load: () => v, save: (t,) => { v = t; }, clear: () => { v = null; }, };
}
const tokens = (a: string,): AuthTokens => ({ accessToken: a, refreshToken: `r-${a}`, });

describe('AuthManager', () => {
    it('auto-loads tokens from the store on construction (bearer)', async () => {
        const mgr = new AuthManager({ mode: 'bearer', store: memStore(tokens('A',),), apiBase: 'http://x/api/v1', fetchImpl: vi.fn(), },);
        await mgr.ready;
        expect((await mgr.authHeaders('GET',))['Authorization'],).toBe('Bearer A',);
    },);
    it('apiKey mode sets the static bearer header, no store', async () => {
        const mgr = new AuthManager({ mode: 'apiKey', apiKey: 'ssk_k', apiBase: 'http://x/api/v1', fetchImpl: vi.fn(), },);
        await mgr.ready;
        expect((await mgr.authHeaders('GET',))['Authorization'],).toBe('Bearer ssk_k',);
    },);
    it('login stores tokens and emits change', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true, data: { user: { id: 'u', }, accessToken: 'A', refreshToken: 'R', expiresAt: 'later', },
        },), { status: 200, headers: { 'content-type': 'application/json', }, },),);
        const store = memStore();
        const mgr = new AuthManager({ mode: 'bearer', store, apiBase: 'http://x/api/v1', fetchImpl, },);
        const changed = vi.fn(); mgr.onChange(changed,);
        const res = await mgr.login({ email: 'a@b.c', password: 'pw', },);
        expect(res.accessToken,).toBe('A',);
        expect((store.load() as AuthTokens).accessToken,).toBe('A',);
        expect(changed,).toHaveBeenCalled();
    },);
    it('cookie-mode login attaches the x-csrf-token header from the csrf cookie', async () => {
        // Server guards POST /auth/login with CSRF; a header-less login is
        // rejected. Login must run the csrf round-trip + send the header.
        const prevDoc = (globalThis as { document?: unknown; }).document;
        (globalThis as { document?: unknown; }).document = { cookie: 'csrf-token=tok123', };
        const loginBody = JSON.stringify({
            success: true, data: { user: { id: 'u', }, accessToken: 'A', refreshToken: 'R', expiresAt: 'l', },
        },);
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response(loginBody, { status: 200, headers: { 'content-type': 'application/json', }, },),
        );
        const mgr = new AuthManager({ mode: 'cookie', apiBase: 'http://x/api/v1', fetchImpl, },);
        await mgr.login({ email: 'a@b.c', password: 'pw', },);
        const loginCall = fetchImpl.mock.calls.find((c,) => String(c[0],).endsWith('/auth/login',),);
        expect(loginCall,).toBeTruthy();
        expect((loginCall![1] as RequestInit).headers,).toMatchObject({ 'x-csrf-token': 'tok123', },);
        (globalThis as { document?: unknown; }).document = prevDoc;
    },);
    it('refresh is single-flight across concurrent callers', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true, data: { user: { id: 'u', }, accessToken: 'A2', refreshToken: 'R2', expiresAt: 'l', },
        },), { status: 200, headers: { 'content-type': 'application/json', }, },),);
        const mgr = new AuthManager({ mode: 'bearer', store: memStore(tokens('A',),), apiBase: 'http://x/api/v1', fetchImpl, },);
        await mgr.ready;
        const [a, b,] = await Promise.all([mgr.refresh(), mgr.refresh(),],);
        expect(a,).toBe(b,);
        expect(fetchImpl,).toHaveBeenCalledOnce(); // de-duped
    },);
    it('logout clears the store', async () => {
        const store = memStore(tokens('A',),);
        const mgr = new AuthManager({ mode: 'bearer', store, apiBase: 'http://x/api/v1', fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200, },),), },);
        await mgr.ready;
        await mgr.logout();
        expect(store.load(),).toBeNull();
    },);
});
