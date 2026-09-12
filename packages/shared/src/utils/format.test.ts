import { describe, expect, it, } from 'vitest';
import { formatDuration, } from './format';

/**
 * `formatDuration` returns `string | null` rather than always a string, and the
 * null cases carry the weight: most social providers report no runtime at all,
 * so absence is the NORMAL path, not an error path. Rendering "0:00" for an
 * unknown length states something false about the post, which is worse than
 * showing nothing — hence the tests pinning every falsy input to null.
 */
describe('formatDuration', () => {
    it('writes under an hour as m:ss, unpadded minutes', () => {
        // Players write "2:05", never "02:05" — padding minutes is only
        // correct once an hours field precedes them.
        expect(formatDuration(125,),).toBe('2:05',);
        expect(formatDuration(42,),).toBe('0:42',);
        expect(formatDuration(60,),).toBe('1:00',);
        expect(formatDuration(599,),).toBe('9:59',);
        expect(formatDuration(3599,),).toBe('59:59',);
    },);

    it('pads the minutes once there is an hours part', () => {
        expect(formatDuration(3600,),).toBe('1:00:00',);
        expect(formatDuration(3724,),).toBe('1:02:04',);
        expect(formatDuration(37_230,),).toBe('10:20:30',);
    },);

    it('returns null for an absent duration — the common case', () => {
        expect(formatDuration(null,),).toBeNull();
        expect(formatDuration(undefined,),).toBeNull();
    },);

    it('returns null rather than "0:00" for a zero or negative length', () => {
        // A live broadcast has no runtime, and a provider that reports 0 is
        // telling us it does not know — not that the video is empty.
        expect(formatDuration(0,),).toBeNull();
        expect(formatDuration(-5,),).toBeNull();
    },);

    it('returns null for values that are not finite numbers', () => {
        expect(formatDuration(Number.NaN,),).toBeNull();
        expect(formatDuration(Number.POSITIVE_INFINITY,),).toBeNull();
    },);

    it('rounds fractional seconds instead of emitting a decimal', () => {
        expect(formatDuration(90.4,),).toBe('1:30',);
        expect(formatDuration(90.6,),).toBe('1:31',);
        // Rounds UP to a whole second rather than being discarded as < 1.
        expect(formatDuration(0.6,),).toBe('0:01',);
    },);
},);
