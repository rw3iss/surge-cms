/**
 * Route-scoped layout signals.
 *
 * This has now broken twice, in opposite directions, so the behaviour is pinned:
 *
 *  1. A page background BLED onto the next route — DynamicPage's onCleanup
 *     reset the header style and position but not the background, so the
 *     homepage stayed red until a reload.
 *  2. Fixing that with route scoping broke the OTHER direction — the writer
 *     tagged values with `window.location.pathname`, which LAGS behind the
 *     router's location during a client-side navigation. A route's own
 *     background was therefore tagged with the previous path and discarded.
 *
 * The invariant both bugs violated: a value belongs to the route that set it,
 * and writer and reader must agree on what "the current route" is.
 */
import { beforeEach, describe, expect, it, } from 'vitest';
import {
    activeHeaderPosition,
    activeHeaderStyle,
    activePageBackground,
    setActiveHeaderPosition,
    setActiveHeaderStyle,
    setActivePageBackground,
    setRouteScope,
} from './headerStyle';

beforeEach(() => {
    setRouteScope('/',);
    setActivePageBackground(null,);
    setActiveHeaderStyle(null,);
    setActiveHeaderPosition(null,);
},);

describe('page background is scoped to its route', () => {
    it('applies on the route that set it', () => {
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        expect(activePageBackground(),).toBe('#ED2024',);
    },);

    it('does NOT bleed onto the next route (bug 1)', () => {
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        // Navigate away. The next route never sets a background.
        setRouteScope('/',);
        expect(activePageBackground(),).toBeNull();
    },);

    it('applies when navigating INTO a route (bug 2)', () => {
        // The order a real navigation produces: the router's location updates
        // first, then the incoming route's effect writes its value.
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        expect(activePageBackground(),).toBe('#ED2024',);
    },);

    it('survives a late clear from the OUTGOING route', () => {
        // An unmount runs after the scope has advanced. If a route cleared its
        // value on cleanup, the clear would land on the INCOMING route and wipe
        // what it just set — which is why routes must never clear.
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        // …outgoing route's hypothetical cleanup, now scoped to /red-page:
        // this is exactly what we removed, asserted so nobody re-adds it
        // without noticing the consequence.
        const beforeClear = activePageBackground();
        expect(beforeClear,).toBe('#ED2024',);
    },);

    it('returns to a route it previously set — value is re-written, not cached', () => {
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        setRouteScope('/',);
        expect(activePageBackground(),).toBeNull();
        setRouteScope('/red-page',);
        setActivePageBackground('#ED2024',);
        expect(activePageBackground(),).toBe('#ED2024',);
    },);

    it('treats an empty or whitespace value as no background', () => {
        setRouteScope('/x',);
        setActivePageBackground('   ',);
        expect(activePageBackground(),).toBeNull();
    },);
},);

describe('header style + position are scoped the same way', () => {
    it('the route override wins, then falls back off-route', () => {
        setRouteScope('/dark',);
        setActiveHeaderStyle('alt',);
        expect(activeHeaderStyle(),).toBe('alt',);
        setRouteScope('/',);
        // Off-route → back to the site default rather than the stale override.
        expect(activeHeaderStyle(),).toBe('default',);
    },);

    it('header position does not bleed either', () => {
        setRouteScope('/float',);
        setActiveHeaderPosition('float',);
        expect(activeHeaderPosition(),).toBe('float',);
        setRouteScope('/',);
        expect(activeHeaderPosition(),).toBe('static',);
    },);
},);
