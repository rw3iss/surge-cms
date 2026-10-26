import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0, })), }),);
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('../settings', () => ({ isFeatureEnabledServer: vi.fn(async () => false), }),);

const { codeProblem, normalizeBody, } = await import('./discounts');

const row = {
    active: true, starts_at: null, ends_at: null, max_uses: null, max_uses_per_user: null, min_subtotal_cents: null,
    allowed_tier_ids: [] as string[], allowed_roles: [] as string[],
};
const ctx = { now: new Date('2026-10-26T12:00:00Z',), uses: 0, userUses: 0, signedIn: false, roles: [] as string[], tierIds: [] as string[], eligibleSubtotal: 5000, };

describe('codeProblem', () => {
    it('usable when nothing limits it', () => expect(codeProblem(row, ctx,),).toBeNull(),);
    it('inactive / not started / expired', () => {
        expect(codeProblem({ ...row, active: false, }, ctx,),).toMatch(/not active/,);
        expect(codeProblem({ ...row, starts_at: new Date('2026-11-01',), }, ctx,),).toMatch(/not active yet/,);
        expect(codeProblem({ ...row, ends_at: new Date('2026-10-01',), }, ctx,),).toMatch(/expired/,);
    },);
    it('uses: total and per buyer', () => {
        expect(codeProblem({ ...row, max_uses: 3, }, { ...ctx, uses: 3, },),).toMatch(/used up/,);
        expect(codeProblem({ ...row, max_uses: 3, }, { ...ctx, uses: 2, },),).toBeNull();
        expect(codeProblem({ ...row, max_uses_per_user: 1, }, { ...ctx, userUses: 1, },),).toMatch(/already used/,);
    },);
    it('membership level / role limits', () => {
        const limited = { ...row, allowed_tier_ids: ['gold',], allowed_roles: ['affiliate',], };
        expect(codeProblem(limited, ctx,),).toMatch(/Sign in/,);
        expect(codeProblem(limited, { ...ctx, signedIn: true, tierIds: ['free',], },),).toMatch(/members only/,);
        expect(codeProblem(limited, { ...ctx, signedIn: true, tierIds: ['gold',], },),).toBeNull();
        expect(codeProblem(limited, { ...ctx, signedIn: true, roles: ['member', 'affiliate',], },),).toBeNull();
    },);
    it('minimum order', () => {
        expect(codeProblem({ ...row, min_subtotal_cents: 6000, }, ctx,),).toMatch(/\$60\.00 or more/,);
    },);
},);

describe('normalizeBody', () => {
    it('validates the code and percents', () => {
        expect(() => normalizeBody({ code: 'a', },),).toThrow(/Code/,);
        expect(() => normalizeBody({ code: 'SAVE10', percent: 120, },),).toThrow(/Percent/,);
        expect(normalizeBody({ code: ' SAVE10 ', },).code,).toBe('SAVE10',);
    },);
    it('affiliate codes: percent only, buyer discount within the commission, default 10%', () => {
        expect(() => normalizeBody({ code: 'AFF1', affiliateUserId: 'u1', kind: 'fixed', },),).toThrow(/percent/,);
        expect(() => normalizeBody({ code: 'AFF1', affiliateUserId: 'u1', commissionPercent: 10, percent: 15, },),).toThrow(/cannot be more/,);
        expect(normalizeBody({ code: 'AFF1', affiliateUserId: 'u1', },).commissionPercent,).toBe(10,);
    },);
    it('end after start', () => {
        expect(() => normalizeBody({ code: 'X10', startsAt: '2026-11-02', endsAt: '2026-11-01', },),).toThrow(/end date/,);
    },);
},);
