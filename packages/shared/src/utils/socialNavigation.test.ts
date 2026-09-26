/**
 * Navigation for the social block's Horizontal Row layout.
 *
 * The row is the only layout that scrolls, so the setting is meaningful only
 * there. Resolving it against the LAYOUT as well as the stored value means a
 * block switched from Row to Grid cannot keep painting arrows over a static
 * grid — the alternative is every consumer remembering to check the layout
 * first, and one that forgets ships a control that does nothing.
 */
import { describe, expect, it, } from 'vitest';
import {
    resolveSocialNavigation,
    resolveSocialNavPadding,
    SOCIAL_NAVIGATION_LABELS,
    SOCIAL_NAVIGATIONS,
} from './socialDisplay';

describe('resolveSocialNavigation', () => {
    it.each(['dots', 'bottom-arrows', 'side-arrows', 'none',],)(
        'returns %j for a row layout',
        (nav,) => {
            expect(resolveSocialNavigation({ layout: 'row', navigation: nav, },),).toBe(nav,);
        },
    );

    it('defaults to none when unset', () => {
        // Existing row blocks must be unchanged by this feature.
        expect(resolveSocialNavigation({ layout: 'row', },),).toBe('none',);
    });

    it.each(['grid', '1-col', undefined,],)(
        'is none for the non-scrolling layout %j, whatever is stored',
        (layout,) => {
            expect(resolveSocialNavigation({ layout, navigation: 'side-arrows', },),).toBe('none',);
        },
    );

    it('rejects an unrecognised value rather than passing it through', () => {
        // A stray value would reach the DOM as a class name.
        expect(resolveSocialNavigation({ layout: 'row', navigation: 'carousel', },),).toBe('none',);
    });

    it.each([null, undefined, {},],)('survives %j', (s,) => {
        expect(resolveSocialNavigation(s as never,),).toBe('none',);
    },);

    it('has a label for every value', () => {
        for (const n of SOCIAL_NAVIGATIONS) {
            expect(SOCIAL_NAVIGATION_LABELS[n],).toBeTruthy();
        }
        expect(Object.keys(SOCIAL_NAVIGATION_LABELS,).length,).toBe(SOCIAL_NAVIGATIONS.length,);
    });
});

describe('resolveSocialNavPadding', () => {
    it('returns the configured value', () => {
        expect(resolveSocialNavPadding({ navPadding: '12px', },),).toBe('12px',);
    });

    it('trims', () => {
        expect(resolveSocialNavPadding({ navPadding: '  8px 4px  ', },),).toBe('8px 4px',);
    });

    it.each(['', '   ', undefined, null,],)('returns undefined for %j', (v,) => {
        // undefined, not '', so a caller can omit the property entirely rather
        // than emitting `padding: ''`.
        expect(resolveSocialNavPadding({ navPadding: v, } as never,),).toBeUndefined();
    },);

    it('survives no settings at all', () => {
        expect(resolveSocialNavPadding(undefined,),).toBeUndefined();
    });
});
