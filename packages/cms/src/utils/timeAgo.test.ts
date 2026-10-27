import { describe, expect, it, } from 'vitest';
import { timeAgo, } from './timeAgo';

const NOW = Date.parse('2026-10-27T12:00:00Z',);
const ago = (sec: number,) => new Date(NOW - sec * 1000,).toISOString();

describe('timeAgo', () => {
    it('reads seconds as just now', () => {
        expect(timeAgo(ago(5,), NOW,),).toBe('just now',);
        // A clock a little ahead never reads negative.
        expect(timeAgo(ago(-30,), NOW,),).toBe('just now',);
    },);
    it('uses minutes, hours and days', () => {
        expect(timeAgo(ago(5 * 60,), NOW,),).toBe('5m ago',);
        expect(timeAgo(ago(3 * 3600,), NOW,),).toBe('3h ago',);
        expect(timeAgo(ago(2 * 86_400,), NOW,),).toBe('2d ago',);
    },);
    it('falls back to the date after a week', () => {
        const iso = ago(10 * 86_400,);
        expect(timeAgo(iso, NOW,),).toBe(new Date(iso,).toLocaleDateString(),);
    },);
    it('is empty for nothing or a bad date', () => {
        expect(timeAgo(null, NOW,),).toBe('',);
        expect(timeAgo('nope', NOW,),).toBe('',);
    },);
},);
