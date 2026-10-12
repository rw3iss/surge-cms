import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../cache', () => ({ getRedis: () => { throw new Error('no redis',); }, }),);

import { keysFor, modState, moderationRefusal, viewerKey, ipHashOf, } from './moderation';

describe('viewerKey', () => {
    it('keys signed-in users by id and guests by their browser id', () => {
        expect(viewerKey('u1', 'abcdefgh12', 'c1',),).toBe('u:u1',);
        expect(viewerKey(null, 'abcdefgh12', 'c1',),).toBe('a:abcdefgh12',);
    },);
    it('gives a per-socket key when the guest id is missing or odd', () => {
        expect(viewerKey(null, null, 'c1',),).toBe('a:c-c1',);
        expect(viewerKey(null, 'bad id!', 'c1',),).toBe('a:c-c1',);
        expect(viewerKey(null, 'short', 'c1',),).toBe('a:c-c1',);
    },);
},);

describe('keysFor', () => {
    it('adds the ticket user when it differs from the socket key', () => {
        expect(keysFor('a:abcdefgh12', 'u1',),).toEqual(['a:abcdefgh12', 'u:u1',],);
        expect(keysFor('u:u1', 'u1',),).toEqual(['u:u1',],);
        expect(keysFor('a:abcdefgh12', null,),).toEqual(['a:abcdefgh12',],);
    },);
},);

describe('moderationRefusal', () => {
    const now = 1_000_000;
    it('allows a clean viewer', () => {
        expect(moderationRefusal([{},], 'chat', now,),).toBeNull();
    },);
    it('mute blocks chat but not reactions', () => {
        expect(moderationRefusal([{ muted: true, },], 'chat', now,)?.code,).toBe('muted',);
        expect(moderationRefusal([{ muted: true, },], 'react', now,),).toBeNull();
    },);
    it('silence blocks chat and reactions until it runs out', () => {
        const e = { silencedUntil: now + 5 * 60_000, };
        expect(moderationRefusal([e,], 'chat', now,)?.code,).toBe('silenced',);
        expect(moderationRefusal([e,], 'react', now,)?.message,).toContain('5 min',);
        expect(moderationRefusal([e,], 'react', now + 5 * 60_000 + 1,),).toBeNull();
    },);
    it('any of the sender keys counts', () => {
        expect(moderationRefusal([{}, { muted: true, },], 'chat', now,)?.code,).toBe('muted',);
    },);
},);

describe('modState', () => {
    it('reads an expired silence as none', () => {
        expect(modState({ silencedUntil: 10, }, 20,),).toEqual({ muted: false, silencedUntil: null, },);
        expect(modState({ muted: true, silencedUntil: 30, }, 20,),).toEqual({ muted: true, silencedUntil: new Date(30,).toISOString(), },);
        expect(modState(undefined,),).toEqual({ muted: false, silencedUntil: null, },);
    },);
},);

describe('ipHashOf', () => {
    const req = (headers: Record<string, string>, ip = '10.0.0.1',) => ({ headers, socket: { remoteAddress: ip, }, }) as never;
    it('prefers the Cloudflare client IP and never returns the raw address', () => {
        const h = ipHashOf(req({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8', },),);
        expect(h,).toBe(ipHashOf(req({ 'cf-connecting-ip': '1.2.3.4', },),),);
        expect(h,).not.toContain('1.2.3.4',);
        expect(ipHashOf(req({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9', },),),).toBe(ipHashOf(req({}, '5.6.7.8',),),);
    },);
},);
