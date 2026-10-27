import { describe, expect, it, } from 'vitest';
import { shortLabelOf, } from './geo';

describe('shortLabelOf', () => {
    it('builds venue, street, city, region', () => {
        expect(shortLabelOf({
            name: 'Philadelphia City Hall', display_name: 'long',
            address: { house_number: '1400', road: 'John F Kennedy Blvd', city: 'Philadelphia', state: 'Pennsylvania', postcode: '19107', },
        },),).toBe('Philadelphia City Hall, 1400 John F Kennedy Blvd, Philadelphia, Pennsylvania 19107',);
    },);
    it('falls back to the display name with too little detail', () => {
        expect(shortLabelOf({ display_name: 'Atlantic Ocean', address: {}, },),).toBe('Atlantic Ocean',);
    },);
},);
