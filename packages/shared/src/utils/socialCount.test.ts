/**
 * How many posts a social block shows.
 *
 * The reported bug: "Number of posts" could not be changed. The admin panel
 * defaulted an unset block to 1 while the renderer defaulted to 6 — so the
 * field already displayed the value the operator wanted, typing it fired no
 * change event, nothing was written, and the renderer went on showing 6.
 *
 * One resolution, used by both, is the fix; these pin its contract.
 */
import { describe, expect, it, } from 'vitest';
import { resolveSocialCount, SOCIAL_DEFAULT_COUNT, } from './socialDisplay';

describe('resolveSocialCount', () => {
    it('honours an explicit count — the setting that did not stick', () => {
        expect(resolveSocialCount({ count: 1, },),).toBe(1,);
        expect(resolveSocialCount({ count: 3, },),).toBe(3,);
    });

    it('lets the legacy `limit` key win over `count`', () => {
        expect(resolveSocialCount({ limit: 2, count: 9, },),).toBe(2,);
    });

    it('resolves an unset block identically however it is expressed', () => {
        // Panel and renderer both call this, so "unset" must mean one thing.
        const expected = resolveSocialCount({},);
        for (const input of [null, undefined, {}, { count: undefined, },]) {
            expect(resolveSocialCount(input,), String(input,),).toBe(expected,);
        }
    });

    it('never defaults to zero — an unset block must still render', () => {
        // The failure this guards is silent: a 0 default renders an empty
        // block that looks broken, with no setting to point at.
        expect(SOCIAL_DEFAULT_COUNT,).toBeGreaterThan(0,);
        expect(resolveSocialCount({},),).toBeGreaterThan(0,);
    });

    it('infers the count from pinned slots when none is set', () => {
        expect(resolveSocialCount({ items: [{}, {},], },),).toBe(2,);
    });

    it('ignores an empty slot list and falls back to the default', () => {
        // `items: []` is a block that has never been pinned, not "show zero".
        expect(resolveSocialCount({ items: [], },),).toBe(SOCIAL_DEFAULT_COUNT,);
    });

    it('rejects zero, negatives and junk rather than showing nothing', () => {
        for (const bad of [0, -1, NaN, 'abc', null, undefined,]) {
            expect(resolveSocialCount({ count: bad, },), String(bad,),).toBe(SOCIAL_DEFAULT_COUNT,);
        }
    });

    it('caps at 50 so a typo cannot render a thousand embeds', () => {
        expect(resolveSocialCount({ count: 9999, },),).toBe(50,);
        expect(resolveSocialCount({ items: new Array(200,).fill({},), },),).toBe(50,);
    });

    it('floors a fractional count', () => {
        expect(resolveSocialCount({ count: 2.7, },),).toBe(2,);
    });
});
