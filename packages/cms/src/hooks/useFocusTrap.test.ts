/**
 * U5: shared focus trap (ModalShell + gallery lightbox). No DOM in this test
 * environment, so `document` and the elements are small fakes.
 */
import { createRoot, createSignal, } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';
import { activeTrapCount, trapTab, useFocusTrap, } from './useFocusTrap';

type Fake = { focus: () => void; isConnected: boolean; offsetParent: object | null; };
let listeners: ((e: KeyboardEvent,) => void)[] = [];
const doc = {
    activeElement: null as unknown,
    body: { tag: 'body', },
    addEventListener: (_: string, fn: (e: KeyboardEvent,) => void,) => listeners.push(fn,),
    removeEventListener: (_: string, fn: (e: KeyboardEvent,) => void,) => (listeners = listeners.filter((l,) => l !== fn,)),
};
const el = (): Fake => {
    const e: Fake = { isConnected: true, offsetParent: {}, focus: () => { doc.activeElement = e; }, };
    return e;
};
const rootOf = (els: Fake[],) => ({
    querySelectorAll: () => els,
    contains: (x: unknown,) => els.includes(x as Fake,),
}) as unknown as HTMLElement;
const tab = (shiftKey = false,) => ({ key: 'Tab', shiftKey, preventDefault: vi.fn(), }) as unknown as KeyboardEvent;

beforeEach(() => {
    listeners = [];
    doc.activeElement = doc.body;
    vi.stubGlobal('document', doc,);
},);
afterEach(() => vi.unstubAllGlobals(),);

describe('trapTab', () => {
    it('wraps forward from the last and backward from the first', () => {
        const [a, b,] = [el(), el(),];
        const root = rootOf([a, b,],);
        b.focus();
        expect(trapTab(root, tab(),),).toBe(true,);
        expect(doc.activeElement,).toBe(a,);
        expect(trapTab(root, tab(true,),),).toBe(true,);
        expect(doc.activeElement,).toBe(b,);
    });
    it('pulls focus in from outside', () => {
        const a = el();
        expect(trapTab(rootOf([a,],), tab(),),).toBe(true,);
        expect(doc.activeElement,).toBe(a,);
    });
});

describe('useFocusTrap', () => {
    it('only the top trap handles Tab, and closing restores the opener', async () => {
        const opener = el();
        opener.focus();
        const outer = el();
        const inner = el();
        const [innerOpen, setInnerOpen,] = createSignal(false,);
        const dispose = createRoot((d,) => {
            useFocusTrap(() => rootOf([outer,],),);
            useFocusTrap(() => rootOf([inner,],), innerOpen,);
            return d;
        },);
        expect(activeTrapCount(),).toBe(1,);
        listeners.forEach((l,) => l(tab(),),);
        expect(doc.activeElement,).toBe(outer,);

        const innerOpener = doc.activeElement;
        setInnerOpen(true,);
        expect(activeTrapCount(),).toBe(2,);
        listeners.forEach((l,) => l(tab(),),);
        expect(doc.activeElement,).toBe(inner,);

        setInnerOpen(false,);
        await Promise.resolve();
        expect(doc.activeElement,).toBe(innerOpener,);

        dispose();
        await Promise.resolve();
        expect(activeTrapCount(),).toBe(0,);
        expect(listeners.length,).toBe(0,);
        expect(doc.activeElement,).toBe(opener,);
    });
});
