/** The viewport hold (audit 2026-10-18 F7): one hold, re-armed; user scroll wins. */
import { describe, expect, it, } from 'vitest';
import { createViewportHold, type ViewportEnv, } from './viewportHold';

function fakeEnv() {
    let t = 0;
    let frames: Array<() => void> = [];
    let userScroll: (() => void) | null = null;
    const state = { top: 100, y: 500, minHeight: null as number | null, scrolls: 0, };
    const env: ViewportEnv = {
        raf: (cb,) => { frames.push(cb,); },
        now: () => t,
        anchorTop: () => state.top,
        scrollY: () => state.y,
        scrollBy: (dy,) => { state.y += dy; state.top -= dy; state.scrolls++; },
        scrollTo: (y,) => { state.y = y; state.scrolls++; },
        docHeight: () => 3000,
        innerHeight: () => 800,
        setMinHeight: (px,) => { state.minHeight = px; },
        onUserScroll: (cb,) => { userScroll = cb; return () => { userScroll = null; }; },
    };
    const tick = (ms = 16,) => { t += ms; const f = frames; frames = []; f.forEach((cb,) => cb()); };
    return { env, state, tick, pending: () => frames.length, userScroll: () => userScroll?.(), };
}

describe('viewport hold', () => {
    it('re-arms ONE loop instead of stacking a loop per call', () => {
        const f = fakeEnv();
        const h = createViewportHold(f.env,);
        h.hold('a',);
        h.hold('a',);
        h.hold('a',);
        expect(f.pending(),).toBe(1,);
    },);

    it('pulls the anchor back to where it was, then releases the pin', () => {
        const f = fakeEnv();
        const h = createViewportHold(f.env,);
        h.hold('a', { minMs: 50, },);
        expect(f.state.minHeight,).toBe(3000,);
        f.state.top = 140; // content above grew by 40px
        f.tick();
        expect(f.state.top,).toBe(100,);
        for (let i = 0; i < 20; i++) f.tick();
        expect(h.isHolding(),).toBe(false,);
        expect(f.state.minHeight,).toBeNull();
    },);

    it('a user scroll ends the hold at once (no pull-back)', () => {
        const f = fakeEnv();
        const h = createViewportHold(f.env,);
        h.hold('a',);
        f.userScroll();
        expect(h.isHolding(),).toBe(false,);
        f.state.top = 300;
        const before = f.state.scrolls;
        f.tick();
        expect(f.state.scrolls,).toBe(before,);
    },);
},);
