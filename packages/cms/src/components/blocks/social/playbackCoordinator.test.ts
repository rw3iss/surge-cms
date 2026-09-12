/**
 * The coordinator's contract is "starting one pauses the others", and the parts
 * worth pinning are the ones that are easy to get subtly wrong:
 *
 *  - the player that just started must NOT be paused (it would stop itself);
 *  - an unregistered player must not be reachable (a removed block that still
 *    receives pause() is a leak that only shows up as a console error weeks
 *    later);
 *  - a message from another frame must not be able to pause the page's video.
 *
 * The YouTube adapter is exercised through a fake iframe rather than a real
 * embed: the protocol is the contract here — which message it sends, which
 * origin it targets, which incoming messages it believes — and a live player
 * would make those assertions non-deterministic without testing anything extra.
 */
import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import {
    __resetForTest,
    attachYouTubePlayer,
    notifyPlaying,
    register,
    type CoordinatedPlayer,
} from './playbackCoordinator';

const YT = 'https://www.youtube.com';

/** A stand-in for the cross-origin player frame. */
function fakeIframe(src = `${YT}/embed/abc?enablejsapi=1`,) {
    const posted: Array<{ message: unknown; target: string; }> = [];
    const listeners = new Map<string, Set<EventListener>>();
    const contentWindow = {
        postMessage: (message: string, target: string,) => {
            posted.push({ message: JSON.parse(message,), target, },);
        },
    };
    const el = {
        src,
        contentWindow,
        addEventListener: (t: string, fn: EventListener,) => {
            if (!listeners.has(t,)) listeners.set(t, new Set(),);
            listeners.get(t,)!.add(fn,);
        },
        removeEventListener: (t: string, fn: EventListener,) => listeners.get(t,)?.delete(fn,),
    } as unknown as HTMLIFrameElement;
    return { el, posted, contentWindow, };
}

/** Deliver a message as if the player sent it. */
function sendFromPlayer(source: unknown, payload: unknown, origin = YT,) {
    windowStub.dispatchEvent(
        Object.assign(new Event('message',), {
            data: JSON.stringify(payload,),
            origin,
            source,
        },),
    );
}

/**
 * A `window` for the module to listen on.
 *
 * The suite runs in the `node` environment (the admin has no jsdom dependency
 * and its other tests don't need one), but this module legitimately listens on
 * window for cross-frame messages. Node ships EventTarget and Event as globals,
 * which is exactly the surface used here — so the stub is real event plumbing,
 * not a mock that could agree with a wrong implementation.
 */
let windowStub: EventTarget;

beforeEach(() => {
    __resetForTest();
    windowStub = new EventTarget();
    (globalThis as { window?: unknown; }).window = windowStub;
    vi.useFakeTimers();
},);
afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown; }).window;
},);

describe('notifyPlaying', () => {
    it('pauses every other player but not the one that started', () => {
        const a: CoordinatedPlayer = { pause: vi.fn(), };
        const b: CoordinatedPlayer = { pause: vi.fn(), };
        const c: CoordinatedPlayer = { pause: vi.fn(), };
        register(a,); register(b,); register(c,);

        notifyPlaying(b,);

        expect(a.pause,).toHaveBeenCalledTimes(1,);
        expect(c.pause,).toHaveBeenCalledTimes(1,);
        expect(b.pause,).not.toHaveBeenCalled();
    },);

    it('pauses everything when nothing is the new active player', () => {
        const a: CoordinatedPlayer = { pause: vi.fn(), };
        register(a,);
        notifyPlaying(null,);
        expect(a.pause,).toHaveBeenCalledTimes(1,);
    },);

    it('stops reaching a player once it unregisters', () => {
        const gone: CoordinatedPlayer = { pause: vi.fn(), };
        const kept: CoordinatedPlayer = { pause: vi.fn(), };
        const unregister = register(gone,);
        register(kept,);

        unregister();
        notifyPlaying(null,);

        expect(gone.pause,).not.toHaveBeenCalled();
        expect(kept.pause,).toHaveBeenCalledTimes(1,);
    },);
},);

describe('attachYouTubePlayer', () => {
    it('polls the frame with a listening handshake until it answers', () => {
        const { el, posted, contentWindow, } = fakeIframe();
        attachYouTubePlayer(el,);

        vi.advanceTimersByTime(1000,);
        const pings = posted.filter(p => (p.message as any).event === 'listening');
        expect(pings.length,).toBeGreaterThan(1,);
        // Addressed to the frame's own origin, never '*'.
        expect(pings.every(p => p.target === YT,),).toBe(true,);

        // The first reply means it is listening — stop pinging.
        const before = posted.length;
        sendFromPlayer(contentWindow, { event: 'onReady', },);
        vi.advanceTimersByTime(2000,);
        expect(posted.length,).toBe(before,);
    },);

    it('gives up pinging a frame that never answers', () => {
        const { el, posted, } = fakeIframe();
        attachYouTubePlayer(el,);
        vi.advanceTimersByTime(11_000,);
        const after = posted.length;
        vi.advanceTimersByTime(5_000,);
        expect(posted.length,).toBe(after,);
    },);

    it('pauses the other player when this one reports playing', () => {
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        const { el, contentWindow, } = fakeIframe();
        attachYouTubePlayer(el,);

        // infoDelivery nests the state; onStateChange carries it directly.
        sendFromPlayer(contentWindow, { event: 'infoDelivery', info: { playerState: 1, }, },);
        expect(other.pause,).toHaveBeenCalledTimes(1,);

        sendFromPlayer(contentWindow, { event: 'onStateChange', info: 1, },);
        expect(other.pause,).toHaveBeenCalledTimes(2,);
    },);

    it('ignores states that are not "playing"', () => {
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        const { el, contentWindow, } = fakeIframe();
        attachYouTubePlayer(el,);

        for (const state of [-1, 0, 2, 3, 5,]) {   // unstarted/ended/paused/buffering/cued
            sendFromPlayer(contentWindow, { event: 'infoDelivery', info: { playerState: state, }, },);
        }
        expect(other.pause,).not.toHaveBeenCalled();
    },);

    it('sends pauseVideo when another player starts', () => {
        const { el, posted, } = fakeIframe();
        attachYouTubePlayer(el,);
        posted.length = 0;

        notifyPlaying(null,);

        expect(posted,).toHaveLength(1,);
        expect(posted[0]!.message,).toEqual({ event: 'command', func: 'pauseVideo', args: [], },);
        expect(posted[0]!.target,).toBe(YT,);
    },);

    it('ignores a message from a different frame', () => {
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        const { el, } = fakeIframe();
        attachYouTubePlayer(el,);

        // Right shape, right origin, WRONG window: an unrelated allowed frame
        // must not be able to pause the page's video.
        sendFromPlayer({ notTheFrame: true, }, { event: 'infoDelivery', info: { playerState: 1, }, },);
        expect(other.pause,).not.toHaveBeenCalled();
    },);

    it('ignores a message from an unexpected origin', () => {
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        const { el, contentWindow, } = fakeIframe();
        attachYouTubePlayer(el,);

        sendFromPlayer(contentWindow, { event: 'infoDelivery', info: { playerState: 1, }, }, 'https://evil.example');
        expect(other.pause,).not.toHaveBeenCalled();
    },);

    it('targets youtube-nocookie when the embed uses it', () => {
        const { el, posted, } = fakeIframe('https://www.youtube-nocookie.com/embed/abc?enablejsapi=1',);
        attachYouTubePlayer(el,);
        vi.advanceTimersByTime(400,);
        expect(posted[0]!.target,).toBe('https://www.youtube-nocookie.com',);
    },);

    it('survives non-JSON chatter from the player', () => {
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        const { el, contentWindow, } = fakeIframe();
        attachYouTubePlayer(el,);

        expect(() => {
            windowStub.dispatchEvent(Object.assign(new Event('message',), {
                data: 'not json at all', origin: YT, source: contentWindow,
            },),);
        },).not.toThrow();
        expect(other.pause,).not.toHaveBeenCalled();
    },);

    it('cleanup unregisters and stops listening', () => {
        const { el, posted, contentWindow, } = fakeIframe();
        const detach = attachYouTubePlayer(el,);
        detach();

        // No longer in the set: a page-wide pause must not reach it.
        posted.length = 0;
        notifyPlaying(null,);
        expect(posted,).toHaveLength(0,);

        // No longer polling.
        vi.advanceTimersByTime(3000,);
        expect(posted,).toHaveLength(0,);

        // And a late message from the frame does nothing.
        const other: CoordinatedPlayer = { pause: vi.fn(), };
        register(other,);
        sendFromPlayer(contentWindow, { event: 'infoDelivery', info: { playerState: 1, }, },);
        expect(other.pause,).not.toHaveBeenCalled();
    },);
},);
