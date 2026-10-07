import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(), }),);
const { frequency, } = await import('./membership');

describe('frequency', () => {
    it('reads like billing copy', () => {
        expect(frequency('month',),).toBe('monthly',);
        expect(frequency('year',),).toBe('yearly',);
        expect(frequency('week',),).toBe('weekly',);
        expect(frequency('month', 3,),).toBe('every 3 months',);
    },);
},);
