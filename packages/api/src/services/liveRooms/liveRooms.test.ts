import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, }, }),);

import type { LiveClientCommand, } from '@sitesurge/types';
import { chatDecision, decideCommand, type LiveIdentity, type LiveRoomPolicyState, parseCommand, validateChatText, } from './authz';
import { RateLimiter, chatLimiter, } from './rateLimit';
import { createTicket, TICKET_TTL_SEC, verifyTicket, } from './tickets';

const POST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

describe('tickets', () => {
    it('round-trips a user and an anonymous ticket', () => {
        expect(verifyTicket(POST, createTicket(POST, USER,).token,),).toEqual({ userId: USER, },);
        expect(verifyTicket(POST, createTicket(POST, null,).token,),).toEqual({ userId: null, },);
    },);
    it('is bound to the post', () => {
        expect(verifyTicket(OTHER, createTicket(POST, USER,).token,),).toBeNull();
    },);
    it('rejects tampering with the user, expiry or signature', () => {
        const { token, } = createTicket(POST, USER,);
        const [exp, , sig,] = token.split('.',);
        expect(verifyTicket(POST, `${exp}.${OTHER}.${sig}`,),).toBeNull();
        expect(verifyTicket(POST, `${exp}.anon.${sig}`,),).toBeNull();
        expect(verifyTicket(POST, `${Number(exp,) + 100}.${USER}.${sig}`,),).toBeNull();
        expect(verifyTicket(POST, `${exp}.${USER}.${sig.slice(0, -1,)}${sig.endsWith('A',) ? 'B' : 'A'}`,),).toBeNull();
        expect(verifyTicket(POST, 'garbage',),).toBeNull();
        expect(verifyTicket(POST, undefined,),).toBeNull();
    },);
    it('expires after the TTL', () => {
        const now = Date.now();
        const { token, expiresAt, } = createTicket(POST, USER, now,);
        expect(new Date(expiresAt,).getTime() - now,).toBeLessThanOrEqual(TICKET_TTL_SEC * 1000,);
        expect(verifyTicket(POST, token, now + (TICKET_TTL_SEC - 5) * 1000,),).not.toBeNull();
        expect(verifyTicket(POST, token, now + (TICKET_TTL_SEC + 5) * 1000,),).toBeNull();
    },);
},);

const anon: LiveIdentity = { userId: null, isHost: false, canModerate: false, rank: null, };
const member: LiveIdentity = { userId: USER, isHost: false, canModerate: false, rank: null, };
const freeTier: LiveIdentity = { ...member, rank: 0, };
const subscriber: LiveIdentity = { ...member, rank: 10, };
const host: LiveIdentity = { userId: USER, isHost: true, canModerate: true, rank: Infinity, };
const room = (extra: Partial<LiveRoomPolicyState> = {},): LiveRoomPolicyState => ({
    status: 'live', chatMode: 'public', reactionsEnabled: true, ...extra,
});
const code = (cmd: LiveClientCommand, id: LiveIdentity, r = room(),) => {
    const d = decideCommand(cmd, id, r,);
    return d.ok ? 'ok' : d.code;
};

describe('decideCommand', () => {
    it('ping and join are always allowed (ping even when ended)', () => {
        expect(code({ type: 'ping', }, anon, room({ status: 'ended', },),),).toBe('ok',);
        expect(code({ type: 'join', }, anon,),).toBe('ok',);
        expect(code({ type: 'join', }, anon, room({ status: 'ended', },),),).toBe('ended',);
    },);
    it('host commands need a signed-in host', () => {
        expect(code({ type: 'start', }, anon, room({ status: 'idle', },),),).toBe('unauthorized',);
        expect(code({ type: 'start', }, subscriber, room({ status: 'idle', },),),).toBe('forbidden',);
        expect(code({ type: 'start', }, host, room({ status: 'idle', },),),).toBe('ok',);
        expect(code({ type: 'mute', }, member,),).toBe('forbidden',);
        expect(code({ type: 'chat_mode', mode: 'off', }, host,),).toBe('ok',);
        expect(code({ type: 'chat_mode', mode: 'nope' as never, }, host,),).toBe('invalid',);
        expect(code({ type: 'reactions', enabled: false, }, host,),).toBe('ok',);
    },);
    it('follows the lifecycle: start from idle, pause when live, resume when paused', () => {
        expect(code({ type: 'start', }, host, room({ status: 'live', },),),).toBe('invalid',);
        expect(code({ type: 'pause', }, host, room({ status: 'idle', },),),).toBe('not_live',);
        expect(code({ type: 'pause', }, host,),).toBe('ok',);
        expect(code({ type: 'resume', }, host,),).toBe('invalid',);
        expect(code({ type: 'resume', }, host, room({ status: 'paused', },),),).toBe('ok',);
    },);
    it('end needs confirm: true, and nothing but ping works once ended', () => {
        expect(code({ type: 'end', } as never, host,),).toBe('invalid',);
        expect(code({ type: 'end', confirm: true, }, host,),).toBe('ok',);
        expect(code({ type: 'chat', text: 'hi', }, host, room({ status: 'ended', },),),).toBe('ended',);
        expect(code({ type: 'resume', }, host, room({ status: 'ended', },),),).toBe('ended',);
    },);
    it('chat: anonymous never; off refuses everyone; subscribers mode needs a paid tier or a host', () => {
        expect(code({ type: 'chat', text: 'hi', }, anon,),).toBe('unauthorized',);
        expect(code({ type: 'chat', text: 'hi', }, member,),).toBe('ok',);
        expect(code({ type: 'chat', text: 'hi', }, member, room({ chatMode: 'members', },),),).toBe('ok',);
        expect(code({ type: 'chat', text: 'hi', }, host, room({ chatMode: 'off', },),),).toBe('chat_off',);
        expect(code({ type: 'chat', text: 'hi', }, member, room({ chatMode: 'subscribers', },),),).toBe('chat_restricted',);
        expect(code({ type: 'chat', text: 'hi', }, freeTier, room({ chatMode: 'subscribers', },),),).toBe('chat_restricted',);
        expect(code({ type: 'chat', text: 'hi', }, subscriber, room({ chatMode: 'subscribers', },),),).toBe('ok',);
        expect(code({ type: 'chat', text: 'hi', }, host, room({ chatMode: 'subscribers', },),),).toBe('ok',);
        expect(code({ type: 'chat', text: 'hi', }, member, room({ status: 'idle', },),),).toBe('ok',);
        expect(chatDecision(anon, room(),).ok,).toBe(false,);
    },);
    it('react: anyone while live with reactions on, known emoji only', () => {
        expect(code({ type: 'react', emoji: '🔥', }, anon,),).toBe('ok',);
        expect(code({ type: 'react', emoji: '💩', }, anon,),).toBe('invalid',);
        expect(code({ type: 'react', emoji: '🔥', }, anon, room({ reactionsEnabled: false, },),),).toBe('forbidden',);
        expect(code({ type: 'react', emoji: '🔥', }, anon, room({ status: 'paused', },),),).toBe('not_live',);
    },);
    it('delete_message needs a moderator', () => {
        expect(code({ type: 'delete_message', id: 'm', }, anon,),).toBe('unauthorized',);
        expect(code({ type: 'delete_message', id: 'm', }, subscriber,),).toBe('forbidden',);
        expect(code({ type: 'delete_message', id: 'm', }, { ...member, canModerate: true, },),).toBe('ok',);
        expect(code({ type: 'delete_message', id: '', }, host,),).toBe('invalid',);
    },);
    it('unknown commands are invalid', () => {
        expect(code({ type: 'explode', } as never, host,),).toBe('invalid',);
    },);
},);

describe('validateChatText / parseCommand', () => {
    it('trims, refuses empty and over-long text, strips control characters', () => {
        expect(validateChatText('  hi  ',),).toEqual({ ok: true, text: 'hi', },);
        expect(validateChatText('   ',).ok,).toBe(false,);
        expect(validateChatText(42,).ok,).toBe(false,);
        expect(validateChatText('a'.repeat(500,),).ok,).toBe(true,);
        expect(validateChatText('a'.repeat(501,),).ok,).toBe(false,);
        expect(validateChatText('a\u0000b',),).toEqual({ ok: true, text: 'ab', },);
        // Raw text is kept — clients render it as text, never HTML.
        expect(validateChatText('<b>x</b>',),).toEqual({ ok: true, text: '<b>x</b>', },);
    },);
    it('parses only objects with a string type', () => {
        expect(parseCommand('{"type":"ping"}',),).toEqual({ type: 'ping', },);
        expect(parseCommand('nope',),).toBeNull();
        expect(parseCommand('[1]',),).toBeNull();
        expect(parseCommand('{"type":1}',),).toBeNull();
    },);
},);

describe('rate limiter', () => {
    it('chat: 1 per second and 20 per minute', () => {
        const rl = chatLimiter();
        const t0 = 1_000_000;
        expect(rl.take('u', t0,),).toBe(true,);
        expect(rl.take('u', t0 + 500,),).toBe(false,);
        expect(rl.take('other', t0 + 500,),).toBe(true,);
        let t = t0;
        let sent = 1;
        for (let i = 0; i < 30; i++) {
            t += 1001;
            if (rl.take('u', t,)) sent++;
        }
        expect(sent,).toBe(20,);
        expect(rl.take('u', t0 + 61_000 + 30_000,),).toBe(true,);
    },);
    it('prunes idle keys', () => {
        const rl = new RateLimiter([{ max: 1, windowMs: 100, },],);
        rl.take('a', 0,);
        rl.prune(1000,);
        expect(rl.take('a', 1000,),).toBe(true,);
    },);
},);
