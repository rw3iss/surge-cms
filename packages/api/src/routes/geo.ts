/**
 * /api/v1/geo — address search + reverse lookup for map pickers (staff).
 * Proxied to OpenStreetMap Nominatim by services/geo.ts (cached, throttled).
 */
import { z, } from 'zod';
import type { AssertCompatible, GeoReverseQuery, GeoSearchQuery, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { viewerOf, } from '../services/discussions';
import * as geo from '../services/geo';
import * as permissions from '../services/permissions';

const searchQuery = z.object({
    q: z.string().max(200,),
    limit: z.coerce.number().int().min(1,).max(5,).optional(),
},);
type _AssertSearch = AssertCompatible<z.infer<typeof searchQuery>, GeoSearchQuery>;

const reverseQuery = z.object({
    lat: z.coerce.number().min(-90,).max(90,),
    lng: z.coerce.number().min(-180,).max(180,),
},);
type _AssertReverse = AssertCompatible<z.infer<typeof reverseQuery>, GeoReverseQuery>;

export const geoRoutes = [
    defineRoute({
        method: 'get', path: '/search', auth: 'staff',
        summary: 'Places matching an address or venue (≤ 5), for map pickers.',
        input: { query: searchQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), 'geo:lookup',);
            return geo.search(query.q, query.limit,);
        },
    },),
    defineRoute({
        method: 'get', path: '/reverse', auth: 'staff',
        summary: 'The address at a point (null when nothing is there).',
        input: { query: reverseQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), 'geo:lookup',);
            return geo.reverse(query.lat, query.lng,);
        },
    },),
];
