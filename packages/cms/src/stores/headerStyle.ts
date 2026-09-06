/**
 * Active header color style for the current route.
 *
 * The Site Header carries a regular and an "alt" (dark) color pair. Each
 * route decides which pair the header renders in. Because the Header is
 * rendered by `Layout` (a sibling of the routed page content), a route
 * publishes its choice here and the Header reads it.
 *
 * Two layers:
 *   - `routeHeaderStyle` — the current route's explicit override, or `null`
 *     when the route doesn't set one (home, contact, shop, cart, …).
 *   - `siteDefaultPageHeaderStyle` — the site-wide default (Site Header →
 *     "Default Page Header Style"), applied to any route without an override.
 *     The `Header` sets it from the loaded header settings.
 *
 * `activeHeaderStyle()` resolves them: the route override wins, else the site
 * default. So a route that never touches the signal still picks up the site
 * default automatically.
 */
import { createSignal, } from 'solid-js';

export type HeaderStyleMode = 'default' | 'alt';
export type HeaderPosition = 'static' | 'float';

// Per-route override. `null` = no override → fall back to the site default.
const [routeHeaderStyle, setRouteHeaderStyle,] = createSignal<HeaderStyleMode | null>(null,);

// Site-wide default for routes without an explicit style.
const [siteDefaultPageHeaderStyle, setSiteDefaultPageHeaderStyle,] = createSignal<HeaderStyleMode>('default',);

/** Resolved style the Header + items render in: route override, else site default. */
export const activeHeaderStyle = (): HeaderStyleMode => routeHeaderStyle() ?? siteDefaultPageHeaderStyle();

/** A route sets its explicit style, or clears it with `null` (→ site default). */
export const setActiveHeaderStyle = (value: HeaderStyleMode | null,): void => {
    setRouteHeaderStyle(value,);
};

// ─── Header position (static vs float) — same two-layer resolution ───

const [routeHeaderPosition, setRouteHeaderPosition,] = createSignal<HeaderPosition | null>(null,);
const [siteDefaultHeaderPosition, setSiteDefaultHeaderPosition,] = createSignal<HeaderPosition>('static',);

/** Resolved header position: route override, else the site default. */
export const activeHeaderPosition = (): HeaderPosition => routeHeaderPosition() ?? siteDefaultHeaderPosition();

/** A route sets its explicit position, or clears it with `null` (→ site default). */
export const setActiveHeaderPosition = (value: HeaderPosition | null,): void => {
    setRouteHeaderPosition(value,);
};

// ─── Page background ───
//
// Published the same way as header style, and for the same reason: the element
// that must carry it (`.layout`) is a SIBLING of the routed page, not a
// descendant. Setting it on the page's own wrapper only ever paints the
// max-width content column, leaving the gutters and the area behind the header
// unpainted — which is exactly what it looked like.

const [routePageBackground, setRoutePageBackground,] = createSignal<string | null>(null,);

/** The current route's background: a raw hex or a `swatch:<id>` ref, else null. */
export const activePageBackground = (): string | null => routePageBackground();

/** A route sets its background, or clears it with `null` (→ site background). */
export const setActivePageBackground = (value: string | null,): void => {
    setRoutePageBackground(value && value.trim() ? value.trim() : null,);
};

export { setSiteDefaultHeaderPosition, setSiteDefaultPageHeaderStyle, };
