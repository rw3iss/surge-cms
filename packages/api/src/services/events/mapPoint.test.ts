import { describe, expect, it, vi, } from 'vitest';

vi.mock('../geo', () => ({ search: vi.fn(async (q: string,) => (q.includes('nowhere',) ? [] : [{ lat: 39.95, lng: -75.16, label: q, },])), }),);
vi.mock('../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);
const { mapPointFor, } = await import('./crud');

describe('mapPointFor', () => {
    it('places an address when the map is on and there is no point', async () => {
        expect(await mapPointFor(true, 'City Hall, Philadelphia', null,),).toEqual({ locationLat: 39.95, locationLng: -75.16, },);
    },);
    it('does nothing when the map is off, a point exists, or there is no address', async () => {
        expect(await mapPointFor(false, 'City Hall', null,),).toBeNull();
        expect(await mapPointFor(true, 'City Hall', 1,),).toBeNull();
        expect(await mapPointFor(true, '  ', null,),).toBeNull();
    },);
    it('an address with no match saves without a point', async () => {
        expect(await mapPointFor(true, 'nowhere at all', null,),).toBeNull();
    },);
},);
