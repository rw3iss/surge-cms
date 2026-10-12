/**
 * Event access: view vs register floors, inherit from settings, the stricter
 * rule names the tier, ticket tier gates, and the 403 shape the client reads.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

let level = -1;
let settings: Record<string, unknown> = {};
vi.mock('../access/level', () => ({
    viewerLevel: async () => level,
    floorFor: async (rule: string, tierId: string | null,) => (rule === 'public' ? -1 : rule === 'members' ? 0 : tierId === 'gold' ? 3 : 1),
    refusalReason: (l: number, f: number,) => (l >= f ? null : l < 0 ? (f <= 0 ? 'signin' : 'subscribe') : 'subscribe'),
    tierInfo: async (id: string | null,) => (id ? { id, name: id === 'gold' ? 'Gold' : 'Silver', } : null),
}),);
vi.mock('./settings', () => ({ getSettings: async () => ({ viewAccess: 'public', viewMinTierId: null, registerAccess: 'public', registerMinTierId: null, ...settings, }), }),);
vi.mock('../postGate', () => ({ tiersById: async () => new Map([['gold', {},], ['silver', {},],],), }),);
vi.mock('../../db', () => ({ query: async () => ({ rows: [], }), }),);

const a = await import('./access');
const inherit = { viewAccess: 'inherit', viewMinTierId: null, registerAccess: 'inherit', registerMinTierId: null, } as const;

beforeEach(() => {
    level = -1;
    settings = {};
},);

describe('event access', () => {
    it('public by default', async () => {
        expect(await a.accessFor(inherit, null,),).toMatchObject({ canView: true, canRegister: true, registerReason: null, },);
    },);

    it('view open, registration for Gold subscribers (from settings)', async () => {
        settings = { registerAccess: 'tier', registerMinTierId: 'gold', };
        expect(await a.accessFor(inherit, null,),).toEqual({ canView: true, canRegister: false, registerReason: 'subscribe', requiredTier: { id: 'gold', name: 'Gold', }, },);
        level = 3;
        expect((await a.accessFor(inherit, { id: 'u', role: 'member', },)).canRegister,).toBe(true,);
    },);

    it('an event override beats the settings; registration never looser than viewing', async () => {
        settings = { registerAccess: 'tier', registerMinTierId: 'gold', };
        const e = { ...inherit, viewAccess: 'members', registerAccess: 'public', } as const;
        level = 0;
        expect(await a.accessFor(e, { id: 'u', role: 'member', },),).toMatchObject({ canView: true, canRegister: true, },);
        level = -1;
        expect(await a.accessFor(e, null,),).toMatchObject({ canView: false, canRegister: false, registerReason: 'signin', },);
    },);

    it('assertCanRegister throws SUBSCRIPTION_REQUIRED with the tier in details', async () => {
        level = 0;
        const e = { ...inherit, registerAccess: 'tier', registerMinTierId: 'gold', title: 'Gala', } as const;
        await expect(a.assertCanRegister(e, { id: 'u', role: 'member', },),).rejects.toMatchObject({
            statusCode: 403, code: 'SUBSCRIPTION_REQUIRED', details: { reason: 'subscribe', requiredTier: { id: 'gold', name: 'Gold', }, },
        },);
    },);

    it('ticket tier gate: anonymous → SIGN_IN_REQUIRED, member → SUBSCRIPTION_REQUIRED, gold passes', async () => {
        const tier = { name: 'VIP', requiredTierId: 'gold', };
        await expect(a.assertCanBuyTier(tier, null,),).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED', },);
        level = 0;
        await expect(a.assertCanBuyTier(tier, { id: 'u', },),).rejects.toMatchObject({ code: 'SUBSCRIPTION_REQUIRED', },);
        level = 3;
        await expect(a.assertCanBuyTier(tier, { id: 'u', },),).resolves.toBeUndefined();
        await expect(a.assertCanBuyTier({ name: 'GA', requiredTierId: null, }, null,),).resolves.toBeUndefined();
    },);

    it('filterViewable drops events above the viewer', async () => {
        const open = { ...inherit, id: 1, };
        const members = { ...inherit, id: 2, viewAccess: 'members', } as const;
        expect((await a.filterViewable([open, members,], null,)).map((e,) => e.id,),).toEqual([1,],);
    },);

    it('a tier rule needs a real tier', async () => {
        await expect(a.assertRule('tier', null, 'viewing',),).rejects.toThrow(/Choose the subscription tier/,);
        await expect(a.assertRule('tier', 'gold', 'viewing',),).resolves.toBeUndefined();
    },);
},);
