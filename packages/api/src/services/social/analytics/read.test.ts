import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { likeEscape, resolveRange, } from './read';

describe('analytics read helpers', () => {
    it('escapes LIKE wildcards in a post search', () => {
        expect(likeEscape('50% off_now\\\\',),).toBe('50\\% off\\_now\\\\\\\\',);
        expect(likeEscape('plain',),).toBe('plain',);
    },);
    it('orders a reversed range and defaults to 28 days', () => {
        expect(resolveRange('2026-11-05', '2026-11-01',),).toEqual({ from: '2026-11-01', to: '2026-11-05', },);
        expect(resolveRange(undefined, '2026-11-28',),).toEqual({ from: '2026-11-01', to: '2026-11-28', },);
    },);
},);
