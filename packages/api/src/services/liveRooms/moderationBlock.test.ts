/**
 * S1 — a banned / kicked user must not chat by opening an ANONYMOUS socket
 * and attaching a signed-in ticket: commands are authorised by the ticket,
 * so moderation must check the ticket user's key too.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, clusterWorkers: 1, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../cache', () => ({ getRedis: () => { throw new Error('no redis',); }, }),);
vi.mock('../ws/upgrade', () => ({ registerUpgrade: vi.fn(), userFromUpgrade: vi.fn(), }),);
vi.mock('./access', () => ({ identityFor: vi.fn(), isHost: vi.fn(), viewAccess: vi.fn(), }),);
vi.mock('./state', () => ({ applyHostCommand: vi.fn(), effectiveStatus: vi.fn(), loadLivePost: vi.fn(), toState: vi.fn(), }),);
vi.mock('./store', () => ({}),);

const mods = new Map<string, Record<string, unknown>>();
const banned = new Set<string>();
vi.mock('./moderation', async (orig,) => {
    const real = await orig<typeof import('./moderation')>();
    return {
        ...real,
        getMod: vi.fn(async (_post: string, key: string,) => mods.get(key,) ?? {}),
        isBanned: vi.fn(async (key: string,) => banned.has(key,)),
    };
},);

import { moderationBlock, } from './server';

const POST = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const anonConn = { key: 'a:freshguestkey1', postId: POST, };

describe('moderationBlock (S1)', () => {
    beforeEach(() => { mods.clear(); banned.clear(); },);

    it('allows a clean member on an anonymous socket', async () => {
        expect(await moderationBlock(anonConn, USER, false, 'chat',),).toBeNull();
    },);
    it('refuses a kicked user whose ticket is used from an anonymous socket', async () => {
        mods.set(`u:${USER}`, { kicked: true, },);
        expect((await moderationBlock(anonConn, USER, false, 'chat',))?.code,).toBe('kicked',);
        expect((await moderationBlock(anonConn, USER, false, 'react',))?.code,).toBe('kicked',);
    },);
    it('refuses a banned user in every show', async () => {
        banned.add(`u:${USER}`,);
        expect((await moderationBlock(anonConn, USER, false, 'chat',))?.code,).toBe('banned',);
    },);
    it('never refuses staff', async () => {
        banned.add(`u:${USER}`,);
        expect(await moderationBlock(anonConn, USER, true, 'chat',),).toBeNull();
    },);
},);
