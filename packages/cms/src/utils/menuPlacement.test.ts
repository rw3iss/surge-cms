/**
 * Where the "+ Add Block" menu opens.
 *
 * The reported bug: the button at the END of a block list sits near the bottom
 * of the page, and the menu always opened downward — so it rendered off the
 * viewport and the operator had to scroll the page to reach the items.
 *
 * The failure mode of the FIX is the opposite: flipping when it shouldn't, or
 * anchoring a flipped panel by its top so it lands somewhere unrelated to its
 * own button. Both are covered.
 */
import { describe, expect, it, } from 'vitest';
import { computeMenuPlacement, type MenuGeometry, } from './menuPlacement';

const geo: MenuGeometry = {
    viewportHeight: 900, viewportWidth: 1440,
    offset: 6, minWidth: 240, maxHeightVh: 70, minUsable: 260,
};

const at = (top: number, height = 32,) => ({ top, bottom: top + height, left: 100, });

describe('computeMenuPlacement', () => {
    it('opens BELOW when there is room', () => {
        const p = computeMenuPlacement(at(100,), geo,);
        expect(p.placement,).toBe('below',);
        expect(p.top,).toBe(138,); // 100 + 32 + 6
    },);

    it('flips ABOVE for a trigger near the bottom — the reported bug', () => {
        // A button 60px from the bottom leaves ~0 usable space below.
        const p = computeMenuPlacement(at(840,), geo,);
        expect(p.placement,).toBe('above',);
    },);

    it('anchors a flipped panel by its BOTTOM, against the trigger', () => {
        // Not by `top`: the panel's height isn't known before it renders, so a
        // top-anchored flip lands wherever the height takes it. `bottom` is the
        // distance from the viewport's bottom edge up to the trigger's top.
        const p = computeMenuPlacement(at(840,), geo,);
        expect(p.bottom,).toBe(900 - 840 + 6,);
    },);

    it('does NOT flip for a marginal gain', () => {
        // A short viewport where above is only a little roomier (132 vs 100).
        // Flipping there moves the panel to the other side of the button for
        // no practical benefit, and a small scroll flips it back — jitter.
        const short: MenuGeometry = { ...geo, viewportHeight: 300, };
        const p = computeMenuPlacement(at(150,), short,);
        expect(p.placement,).toBe('below',);
    },);

    it('DOES flip when above is substantially roomier', () => {
        // Same short viewport, trigger pushed to the bottom: above now has
        // ~230px against ~0 below.
        const short: MenuGeometry = { ...geo, viewportHeight: 300, };
        expect(computeMenuPlacement(at(250,), short,).placement,).toBe('above',);
    },);

    it('does NOT flip a trigger in the middle of a tall page', () => {
        const p = computeMenuPlacement(at(400,), geo,);
        expect(p.placement,).toBe('below',);
    },);

    it('caps the height to the space actually available', () => {
        const below = computeMenuPlacement(at(100,), geo,);
        expect(below.maxHeight,).toBeLessThanOrEqual(Math.floor(900 * 0.7,),);
        const above = computeMenuPlacement(at(840,), geo,);
        expect(above.maxHeight,).toBeLessThanOrEqual(840 - 6 - 12,);
    },);

    it('never returns a uselessly small panel', () => {
        // Even pinned against an edge, the menu must be tall enough to use.
        for (const top of [0, 10, 500, 880, 899,]) {
            expect(computeMenuPlacement(at(top,), geo,).maxHeight, `top=${top}`,)
                .toBeGreaterThanOrEqual(160,);
        }
    },);

    it('pulls the panel back on screen horizontally', () => {
        // A trigger near the right edge would otherwise open past it.
        const p = computeMenuPlacement({ top: 100, bottom: 132, left: 1400, }, geo,);
        expect(p.left + geo.minWidth,).toBeLessThanOrEqual(geo.viewportWidth,);
    },);

    it('leaves a comfortably-placed trigger horizontally alone', () => {
        expect(computeMenuPlacement(at(100,), geo,).left,).toBe(100,);
    },);
},);
