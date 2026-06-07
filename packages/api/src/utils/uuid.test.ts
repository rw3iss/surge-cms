import { describe, expect, it, } from 'vitest';
import { uuidOrNull, } from './uuid';

describe('uuidOrNull', () => {
    it('passes a valid UUID through', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000';
        expect(uuidOrNull(uuid,),).toBe(uuid,);
    },);

    it('nulls a synthetic api-key actor', () => {
        expect(uuidOrNull('api-key:bot',),).toBeNull();
    },);

    it('nulls the system actor', () => {
        expect(uuidOrNull('system',),).toBeNull();
    },);

    it('nulls undefined', () => {
        expect(uuidOrNull(undefined,),).toBeNull();
    },);

    it('nulls null', () => {
        expect(uuidOrNull(null,),).toBeNull();
    },);

    it('nulls an empty string', () => {
        expect(uuidOrNull('',),).toBeNull();
    },);
},);
