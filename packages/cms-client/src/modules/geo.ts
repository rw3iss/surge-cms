import type { GeoPlace, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /geo — address search + reverse lookup for map pickers (staff; proxied to
 * OpenStreetMap by the server, cached + throttled).
 */
export class GeoModule extends ModuleBase {
    protected readonly module = 'geo';

    /** Places matching an address or venue (≤ 5). */
    search(q: string, limit?: number,): Promise<GeoPlace[]> {
        return this.get('/geo/search', { query: { q, ...(limit ? { limit, } : {}), }, },);
    }

    /** The address at a point, or null. */
    reverse(lat: number, lng: number,): Promise<GeoPlace | null> {
        return this.get('/geo/reverse', { query: { lat, lng, }, },);
    }
}
