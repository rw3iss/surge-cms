import { describe, expect, it, } from 'vitest';
import { eventLocationText, mapLinkFor, } from './mapLink';

describe('mapLinkFor', () => {
    it('prefers the exact point', () => {
        expect(mapLinkFor({ location: 'City Hall', lat: 39.9526, lng: -75.1652, },),).toBe('https://www.google.com/maps/search/?api=1&query=39.952600,-75.165200',);
    },);
    it('falls back to the text, else null', () => {
        expect(mapLinkFor({ location: 'City Hall, Philadelphia', },),).toContain('query=City%20Hall%2C%20Philadelphia',);
        expect(mapLinkFor({ location: ' ', lat: 999, lng: 0, },),).toBeNull();
    },);
},);

describe('eventLocationText', () => {
    it('shows the label when set, else the address', () => {
        expect(eventLocationText({ location: '1 Penn Sq', locationLabel: 'City Hall', },),).toBe('City Hall',);
        expect(eventLocationText({ location: '1 Penn Sq', locationLabel: '  ', },),).toBe('1 Penn Sq',);
        expect(eventLocationText({},),).toBeNull();
    },);
},);
