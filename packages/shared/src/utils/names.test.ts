import { describe, expect, it, } from 'vitest';
import { splitFullName, } from './names';

describe('splitFullName', () => {
    it('splits first word from the rest', () => {
        expect(splitFullName('Ryan Weiss',),).toEqual({ firstName: 'Ryan', lastName: 'Weiss', },);
        expect(splitFullName('  Mary  Ann van Dyke ',),).toEqual({ firstName: 'Mary', lastName: 'Ann van Dyke', },);
    });
    it('keeps a single word as the first name', () => {
        expect(splitFullName('Admin',),).toEqual({ firstName: 'Admin', lastName: '', },);
    });
    it('handles empty input', () => {
        expect(splitFullName(null,),).toEqual({ firstName: '', lastName: '', },);
    });
});
