/** U5: arrow keys stay with the player / sliders inside the lightbox. */
import { describe, expect, it, } from 'vitest';
import { arrowsBelongToTarget, } from './focusTrap';

const el = (matches: string[],) => ({ closest: (sel: string,) => (matches.some((m,) => sel.includes(m,),) ? {} : null), });

describe('arrowsBelongToTarget', () => {
    it('player controls and video keep their arrows', () => {
        expect(arrowsBelongToTarget(el(['[class*="vp-"]',],) as never,),).toBe(true,);
        expect(arrowsBelongToTarget(el(['video',],) as never,),).toBe(true,);
    });
    it('form fields and sliders keep their arrows', () => {
        expect(arrowsBelongToTarget(el(['input',],) as never,),).toBe(true,);
        expect(arrowsBelongToTarget(el(['[role="slider"]',],) as never,),).toBe(true,);
    });
    it('anything else (a nav button, the dialog) → lightbox prev / next', () => {
        expect(arrowsBelongToTarget(el([],) as never,),).toBe(false,);
        expect(arrowsBelongToTarget(null,),).toBe(false,);
    });
});
