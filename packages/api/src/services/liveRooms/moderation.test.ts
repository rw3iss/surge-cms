import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../cache', () => ({ getRedis: () => { throw new Error('no redis',); }, }),);

import { isValidViewerKey, keysFor, modState, moderationRefusal, viewerKey, ipHashOf, } from './moderation';

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
    it('reads the nginx-written X-Real-IP and never returns the raw address', () => {
        const h = ipHashOf(req({ 'x-real-ip': '1.2.3.4', },),);
        expect(h,).toBe(ipHashOf(req({}, '1.2.3.4',),),);
        expect(h,).not.toContain('1.2.3.4',);
    },);
    it('ignores client-settable CF-Connecting-IP / X-Forwarded-For (S3)', () => {
        const socketOnly = ipHashOf(req({}, '10.0.0.1',),);
        expect(ipHashOf(req({ 'cf-connecting-ip': '1.2.3.4', },),),).toBe(socketOnly,);
        expect(ipHashOf(req({ 'x-forwarded-for': '5.6.7.8', },),),).toBe(socketOnly,);
        expect(ipHashOf(req({ 'x-real-ip': '9.9.9.9', 'cf-connecting-ip': '1.2.3.4', },),),).toBe(ipHashOf(req({}, '9.9.9.9',),),);
    },);
},);

describe('moderationRefusal — kick and ban (S1)', () => {
    it('a kick on any sender key blocks chat and reactions', () => {
        expect(moderationRefusal([{}, { kicked: true, },], 'chat',)?.code,).toBe('kicked',);
        expect(moderationRefusal([{ kicked: true, },], 'react',)?.code,).toBe('kicked',);
    },);
    it('a ban blocks everything', () => {
        expect(moderationRefusal([{},], 'chat', Date.now(), true,)?.code,).toBe('banned',);
        expect(moderationRefusal([{},], 'react', Date.now(), true,)?.code,).toBe('banned',);
    },);
},);

describe('isValidViewerKey (S5)', () => {
    it('accepts a uuid user key and a guest key', () => {
        expect(isValidViewerKey('u:33333333-3333-4333-8333-333333333333',),).toBe(true,);
        expect(isValidViewerKey('a:abcdefgh12',),).toBe(true,);
        expect(isValidViewerKey('a:c-11111111-1111',),).toBe(true,);
    },);
    it('refuses a non-uuid user key (would 500 in the uuid column)', () => {
        expect(isValidViewerKey('u:abc',),).toBe(false,);
        expect(isValidViewerKey('x:abc',),).toBe(false,);
        expect(isValidViewerKey('a:bad id',),).toBe(false,);
    },);
},);

describe('banExpiry (F3)', () => {
    it('is permanent without minutes, else now + minutes', async () => {
        const { banExpiry, } = await import('./moderation');
        expect(banExpiry(undefined,),).toBeNull();
        expect(banExpiry(0,),).toBeNull();
        expect(banExpiry(60, 1_000,)!.getTime(),).toBe(1_000 + 3_600_000,);
    },);
},);

describe('transcriptText (F2)', () => {
    it('formats lines and marks deleted ones', async () => {
        const { transcriptText, } = await import('./chatLog');
        const txt = transcriptText('My show', [
            { id: '1', userId: null, name: 'Ann', handle: 'ann', role: null, text: 'hi\nthere', at: '2026-10-18T10:00:00.000Z', },
            { id: '2', userId: null, name: 'Bob', role: null, text: 'spam', at: '2026-10-18T10:00:05.000Z', deletedAt: '2026-10-18T10:01:00.000Z', replyTo: { id: '1', name: 'Ann', text: 'hi', }, },
        ],);
        expect(txt,).toContain('Chat transcript — My show',);
        expect(txt,).toContain('[2026-10-18 10:00:00] Ann @ann: hi there',);
        expect(txt,).toContain('Bob (replying to Ann): spam [deleted by a moderator]',);
    },);
},);
