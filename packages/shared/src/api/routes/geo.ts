/**
 * /api/v1/geo — address search + reverse lookup for map pickers (the event
 * Location field). Proxied to OpenStreetMap Nominatim by the server (cached,
 * throttled to its 1 request / second policy) so browsers never call it and
 * the CSP stays closed. Staff only.
 */

/** One place: a display label and its point. */
export interface GeoPlace {
    /** Full display address ("City Hall, 1400 John F Kennedy Blvd, Philadelphia, PA 19107, USA"). */
    label: string;
    lat: number;
    lng: number;
    /** Short form (venue / street + city) when known. */
    shortLabel?: string;
}

export interface GeoSearchQuery { q: string; limit?: number; }
export type GeoSearchResponse = GeoPlace[];

export interface GeoReverseQuery { lat: number; lng: number; }
/** null when nothing is at that point (open sea…). */
export type GeoReverseResponse = GeoPlace | null;
