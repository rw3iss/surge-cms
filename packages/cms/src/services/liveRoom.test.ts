import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';

const liveTicket = vi.fn();
vi.mock('./cmsClient', () => ({ cms: { posts: { liveTicket: (...a: unknown[]) => liveTicket(...a,), }, }, }),);

import { connectLiveRoom, } from './liveRoom';

class FakeSocket {
    static instances: FakeSocket[] = [];
    readyState = 0;
    sent: Record<string, unknown>[] = [];
    private listeners: Record<string, ((e: unknown) => void)[]> = {};
    constructor(public url: string,) {
        FakeSocket.instances.push(this,);
    }
    addEventListener(type: string, fn: (e: unknown) => void,) {
        (this.listeners[type] ??= []).push(fn,);
    }
    private fire(type: string, e?: unknown,) {
        for (const fn of this.listeners[type] ?? []) fn(e,);
    }
    send(data: string,) {
        this.sent.push(JSON.parse(data,),);
    }
    close() {
        this.readyState = 3;
        this.fire('close',);
    }
    serverOpen() {
        this.readyState = 1;
        this.fire('open',);
    }
    serverSend(event: unknown,) {
        this.fire('message', { data: JSON.stringify(event,), },);
    }
    serverDrop() {
        this.readyState = 3;
        this.fire('close',);
    }
}

const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z',),);
    FakeSocket.instances = [];
    liveTicket.mockReset();
    vi.stubGlobal('WebSocket', FakeSocket,);
    vi.stubGlobal('location', { protocol: 'https:', host: 'example.test', },);
},);

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
},);

describe('connectLiveRoom', () => {
    it('fetches a ticket, opens the room URL and attaches the token to every command', async () => {
        liveTicket.mockResolvedValue({ token: 'tk-1', expiresAt: new Date(Date.now() + 15 * 60_000,).toISOString(), userId: 'u1', isHost: false, },);
        const conn = connectLiveRoom('post-1', { onEvent: () => {}, },);
        conn.send({ type: 'chat', text: 'queued', },);
        await flush();
        const sock = FakeSocket.instances[0]!;
        expect(sock.url,).toBe('wss://example.test/ws/live?post=post-1',);
        sock.serverOpen();
        conn.send({ type: 'react', emoji: '🔥', },);
        expect(sock.sent,).toEqual([
            { type: 'join', token: 'tk-1', },
            { type: 'chat', text: 'queued', token: 'tk-1', },
            { type: 'react', emoji: '🔥', token: 'tk-1', },
        ],);
        vi.advanceTimersByTime(25_000,);
        expect(sock.sent.at(-1,),).toEqual({ type: 'ping', token: 'tk-1', },);
        conn.close();
    });

    it('refreshes the ticket ~2 minutes before it expires and uses the new token', async () => {
        liveTicket
            .mockResolvedValueOnce({ token: 'tk-1', expiresAt: new Date(Date.now() + 10 * 60_000,).toISOString(), userId: null, isHost: false, },)
            .mockResolvedValueOnce({ token: 'tk-2', expiresAt: new Date(Date.now() + 20 * 60_000,).toISOString(), userId: null, isHost: false, },);
        const conn = connectLiveRoom('p', { onEvent: () => {}, },);
        await flush();
        FakeSocket.instances[0]!.serverOpen();
        vi.advanceTimersByTime(8 * 60_000 - 1,);
        expect(liveTicket,).toHaveBeenCalledTimes(1,);
        vi.advanceTimersByTime(1,);
        await flush();
        expect(liveTicket,).toHaveBeenCalledTimes(2,);
        conn.send({ type: 'chat', text: 'hi', },);
        expect(FakeSocket.instances[0]!.sent.at(-1,),).toEqual({ type: 'chat', text: 'hi', token: 'tk-2', },);
        conn.close();
    });

    it('reconnects after a drop but not after an `ended` event', async () => {
        liveTicket.mockResolvedValue({ token: 't', expiresAt: new Date(Date.now() + 60 * 60_000,).toISOString(), userId: null, isHost: false, },);
        const events: string[] = [];
        const statuses: string[] = [];
        connectLiveRoom('p', { onEvent: (e,) => events.push(e.type,), onStatus: (s,) => statuses.push(s,), },);
        await flush();
        FakeSocket.instances[0]!.serverOpen();
        FakeSocket.instances[0]!.serverDrop();
        expect(statuses.at(-1,),).toBe('reconnecting',);
        vi.advanceTimersByTime(1_000,);
        await flush();
        expect(FakeSocket.instances,).toHaveLength(2,);
        const second = FakeSocket.instances[1]!;
        second.serverOpen();
        second.serverSend({ type: 'ended', state: { status: 'ended', }, },);
        expect(events,).toContain('ended',);
        expect(statuses.at(-1,),).toBe('closed',);
        vi.advanceTimersByTime(120_000,);
        await flush();
        expect(FakeSocket.instances,).toHaveLength(2,);
    });

    it('surfaces a failed ticket fetch as a server_error event instead of throwing', async () => {
        liveTicket.mockRejectedValue(new Error('boom',),);
        const events: { type: string; code?: string; }[] = [];
        const conn = connectLiveRoom('p', { onEvent: (e,) => events.push(e as never,), },);
        await flush();
        expect(events[0],).toMatchObject({ type: 'error', code: 'server_error', },);
        conn.close();
    });
});
