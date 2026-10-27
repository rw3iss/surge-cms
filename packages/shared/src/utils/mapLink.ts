/**
 * Where "View map →" and a click on a location map go: Google Maps for the
 * exact point when one is known (lat/lng picked on the map), else a search for
 * the location text. Null when there is neither. One rule for the event page,
 * the event entity record and any template.
 */
export function mapLinkFor(p: { location?: string | null; lat?: number | null; lng?: number | null; },): string | null {
    const ok = (n: unknown,): n is number => typeof n === 'number' && Number.isFinite(n,);
    if (ok(p.lat,) && ok(p.lng,) && Math.abs(p.lat,) <= 90 && Math.abs(p.lng,) <= 180) {
        return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6,)},${p.lng.toFixed(6,)}`;
    }
    const q = String(p.location ?? '',).trim();
    return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q,)}` : null;
}

/** A lat/lng pair as shown to people ("40.712776, -74.005974"). */
export function formatLatLng(lat: number, lng: number,): string {
    return `${lat.toFixed(6,)}, ${lng.toFixed(6,)}`;
}
