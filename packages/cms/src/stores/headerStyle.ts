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

// ─── Route scoping ───
//
// Every value below belongs to ONE route. They used to be plain signals that
// each route had to clear in `onCleanup`, which is a rule you only find out was
// broken by seeing the previous page's colour behind the next one: DynamicPage
// cleared the header style and position but not the background, so navigating
// from a red page to the homepage left the homepage red until a refresh.
//
// So a value now records the path that set it and is only returned while the
// visitor is still on that path. A leftover is ignored rather than inherited,
// which makes the leak unrepresentable instead of merely fixed — and removes
// any dependency on cleanup order between a parent Layout and a child route.

const [currentPath, setCurrentPath,] = createSignal(
    typeof window === 'undefined' ? '' : window.location.pathname,
);

/**
 * Called once by `Layout` on navigation. One caller, not one per route — that
 * is the entire point.
 */
export const setRouteScope = (path: string,): void => { setCurrentPath(path,); };

/**
 * NOTE FOR CALLERS: a route must NEVER clear these on unmount.
 *
 * A stale value is already ignored (it is tagged with the route that set it),
 * so clearing is unnecessary — and harmful: an unmount runs *after* the scope
 * has advanced to the incoming route, so the clear would be recorded against
 * the NEW path and wipe the value that route just set. Routes only ever write
 * their own value.
 */

/** A value plus the route it belongs to. */
interface Scoped<T> { path: string; value: T; }

function scopedSignal<T>(empty: T,) {
    const [get, set,] = createSignal<Scoped<T> | null>(null,);
    return {
        /** The value, but only while we're still on the route that set it. */
        read: (): T => {
            const v = get();
            return v && v.path === currentPath() ? v.value : empty;
        },
        write: (value: T,): void => {
            // Scope to `currentPath()` — the SAME source the reader compares
            // against. It must not be `window.location.pathname`: during a
            // client-side navigation the router's location updates FIRST and
            // history lags, so a route writing its background tagged it with
            // the OLD path and the reader (already on the new path) discarded
            // it. The page then stayed unstyled until a reload.
            set({ path: currentPath(), value, } as Scoped<T>,);
        },
    };
}

export type HeaderStyleMode = 'default' | 'alt';
export type HeaderPosition = 'static' | 'float';

// Per-route override. `null` = no override → fall back to the site default.
const routeHeaderStyle = scopedSignal<HeaderStyleMode | null>(null,);

// Site-wide default for routes without an explicit style.
const [siteDefaultPageHeaderStyle, setSiteDefaultPageHeaderStyle,] = createSignal<HeaderStyleMode>('default',);

/** Resolved style the Header + items render in: route override, else site default. */
export const activeHeaderStyle = (): HeaderStyleMode => routeHeaderStyle.read() ?? siteDefaultPageHeaderStyle();

/** A route sets its explicit style, or clears it with `null` (→ site default). */
export const setActiveHeaderStyle = (value: HeaderStyleMode | null,): void => {
    routeHeaderStyle.write(value,);
};

// ─── Header position (static vs float) — same two-layer resolution ───

const routeHeaderPosition = scopedSignal<HeaderPosition | null>(null,);
const [siteDefaultHeaderPosition, setSiteDefaultHeaderPosition,] = createSignal<HeaderPosition>('static',);

/** Resolved header position: route override, else the site default. */
export const activeHeaderPosition = (): HeaderPosition => routeHeaderPosition.read() ?? siteDefaultHeaderPosition();

/** A route sets its explicit position, or clears it with `null` (→ site default). */
export const setActiveHeaderPosition = (value: HeaderPosition | null,): void => {
    routeHeaderPosition.write(value,);
};

// ─── Page background ───
//
// Published the same way as header style, and for the same reason: the element
// that must carry it (`.layout`) is a SIBLING of the routed page, not a
// descendant. Setting it on the page's own wrapper only ever paints the
// max-width content column, leaving the gutters and the area behind the header
// unpainted — which is exactly what it looked like.

const routePageBackground = scopedSignal<string | null>(null,);

/** The current route's background: a raw hex or a `swatch:<id>` ref, else null.
 *  A background set by a PREVIOUS route reads as null here — see Route scoping. */
export const activePageBackground = (): string | null => routePageBackground.read();

/** A route sets its background, or clears it with `null` (→ site background). */
export const setActivePageBackground = (value: string | null,): void => {
    routePageBackground.write(value && value.trim() ? value.trim() : null,);
};

export { setSiteDefaultHeaderPosition, setSiteDefaultPageHeaderStyle, };
