import { describe, expect, it, vi, } from 'vitest';

vi.mock('../geo', () => ({ search: vi.fn(async (q: string,) => (q.includes('nowhere',) ? [] : [{ lat: 39.95, lng: -75.16, label: q, },])), }),);
vi.mock('../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);
const { mapPointFor, pointAfterLocationChange, } = await import('./crud');

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

describe('mapPointFor — never stalls a save', () => {
    it('gives up after the wait and saves without a point', async () => {
        const geo = await import('../geo');
        vi.mocked(geo.search,).mockImplementationOnce(() => new Promise(() => {},),);
        expect(await mapPointFor(true, 'slow place', null, 20,),).toBeNull();
    },);
    it('a failed lookup saves without a point', async () => {
        const geo = await import('../geo');
        vi.mocked(geo.search,).mockRejectedValueOnce(new Error('down',),);
        expect(await mapPointFor(true, 'City Hall', null,),).toBeNull();
    },);
},);

describe('pointAfterLocationChange', () => {
    const existing = { location: '1 Penn Sq', locationLat: 39.95, };
    it('drops the old point when the text changes without a new point', () => {
        expect(pointAfterLocationChange({ location: '2 Market St', }, existing,),).toEqual({ locationLat: null, locationLng: null, },);
        expect(pointAfterLocationChange({ location: null, }, existing,),).toEqual({ locationLat: null, locationLng: null, },);
    },);
    it('keeps it when the patch sends a point, does not change the text, or there is none', () => {
        expect(pointAfterLocationChange({ location: '2 Market St', locationLat: 1, locationLng: 2, }, existing,),).toBeUndefined();
        expect(pointAfterLocationChange({ location: ' 1 Penn Sq ', }, existing,),).toBeUndefined();
        expect(pointAfterLocationChange({}, existing,),).toBeUndefined();
        expect(pointAfterLocationChange({ location: 'x', }, { location: 'y', locationLat: null, },),).toBeUndefined();
    },);
},);
