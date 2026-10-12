import { describe, expect, it, vi, } from 'vitest';

let rank: number | null = null;
let required = false;
vi.mock('../postGate', () => ({
    viewerRank: async () => rank,
    tiersById: async () => new Map([['t1', { id: 't1', name: 'Pro', slug: 'pro', sortOrder: 2, },],],),
}),);
vi.mock('../subscriptionAccess', () => ({ getPolicy: async () => ({ required, }), }),);

const { floorFor, refusalReason, viewerLevel, } = await import('./level');

describe('viewerLevel', () => {
    it('anonymous -1, staff Infinity, member 0, subscriber = rank', async () => {
        expect(await viewerLevel(null,),).toBe(-1,);
        expect(await viewerLevel({ id: 'u', role: 'editor', },),).toBe(Infinity,);
        rank = null;
        expect(await viewerLevel({ id: 'u', role: 'member', },),).toBe(0,);
        rank = 3;
        expect(await viewerLevel({ id: 'u', role: 'member', },),).toBe(3,);
    },);
    it('subscription-required mode: a member without a tier is a visitor', async () => {
        rank = null;
        required = true;
        expect(await viewerLevel({ id: 'u', role: 'member', },),).toBe(-1,);
        required = false;
    },);
},);

describe('floorFor / refusalReason', () => {
    it('maps rules to levels; unknown tier falls back to members', async () => {
        expect(await floorFor('public', null,),).toBe(-1,);
        expect(await floorFor('members', null,),).toBe(0,);
        expect(await floorFor('tier', 't1',),).toBe(2,);
        expect(await floorFor('tier', 'gone',),).toBe(0,);
    },);
    it('says sign in or subscribe', () => {
        expect(refusalReason(-1, 0,),).toBe('signin',);
        expect(refusalReason(-1, 2,),).toBe('subscribe',);
        expect(refusalReason(0, 2,),).toBe('subscribe',);
        expect(refusalReason(2, 2,),).toBeNull();
    },);
},);
