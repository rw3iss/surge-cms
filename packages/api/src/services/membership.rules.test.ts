/**
 * The membership RULES (approval levels, hidden levels, the subscription-required
 * minimum, billing-only changes) — the choices that decide who can buy what.
 * Stripe is not called: these paths throw or answer before any Stripe write.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
const prices: Record<string, unknown> = {};
vi.mock('./cache', () => ({ cache: { get: vi.fn(async () => prices,), set: vi.fn(), }, CACHE_KEYS: { membershipStripePrices: 'k', }, }),);
let stripe: unknown = null;
vi.mock('./payment/stripe', () => ({ getStripeClient: () => stripe, }),);
vi.mock('./mail/purposes', () => ({ sendPurposeMail: vi.fn(), }),);
vi.mock('./payments', () => ({ createCustomer: vi.fn(), }),);
vi.mock('./payment', () => ({ getPaymentProvider: vi.fn(), }),);
const can = vi.fn(async () => false,);
vi.mock('./permissions', () => ({ can: (...a: unknown[]) => can(...a), ENTITLED_STATUSES: ['active', 'trialing', 'past_due',], }),);
const policy = { required: false, minimumRank: 1, minimumTierId: null, requireEmailVerification: false, };
vi.mock('./subscriptionAccess', () => ({ getPolicy: vi.fn(async () => policy,), }),);

type T = Record<string, unknown>;
let tiers: T[] = [];
let currentTier: T | null = null;
vi.mock('./subscriptionTiers', () => ({
    listTiers: vi.fn(async () => tiers,),
    syncUserRole: vi.fn(),
    userSubscription: vi.fn(async () => ({ tier: currentTier, status: currentTier ? 'active' : null, source: 'stripe', currentPeriodEnd: null, cancelAtPeriodEnd: false, }),),
}),);

const { preview, publicTiers, } = await import('./membership');

const tier = (id: string, over: T = {},): T => ({
    id, slug: id, name: id, description: null, role: 'member', isFree: false, isActive: true, priceCents: 2500, interval: 'month', intervalCount: 1,
    displayPrice: null, requiresApproval: false, applicationFormId: null, hidePrice: false, hiddenFromTiers: false, devOnly: false, stripePriceId: `price_${id}`,
    stripeProductId: null, sortOrder: 1, ...over,
});

beforeEach(() => {
    q.mockReset();
    q.mockResolvedValue({ rows: [], },);
    can.mockReset();
    can.mockResolvedValue(false,);
    policy.required = false;
    currentTier = null;
    tiers = [tier('free', { isFree: true, stripePriceId: null, sortOrder: 0, },), tier('club', { requiresApproval: true, },), tier('basic',),];
},);

describe('approval levels', () => {
    it('cannot be bought without applying', async () => {
        await expect(preview('u1', 'club',),).rejects.toThrow(/requires an application/,);
    },);

    it('a member already on the level may change billing (C1)', async () => {
        currentTier = { id: 'club', slug: 'club', name: 'club', isFree: false, };
        tiers = tiers.map((t,) => t.id === 'club' ? { ...t, stripeProductId: 'prod_club', } : t);
        Object.assign(prices, {
            price_club: { amount: 2500, currency: 'usd', interval: 'month', intervalCount: 1, productDescription: null, productId: 'prod_club', },
            price_club_year: { amount: 25000, currency: 'usd', interval: 'year', intervalCount: 1, productDescription: null, productId: 'prod_club', },
        },);
        const createPreview = vi.fn(async () => ({ amount_due: 0, total: -100, }),);
        stripe = {
            subscriptions: { retrieve: vi.fn(async () => ({ id: 'sub_1', customer: 'cus_1', items: { data: [{ id: 'si_1', price: { id: 'price_club', }, current_period_end: 1800000000, current_period_start: 1700000000, },], }, default_payment_method: null, }),), },
            invoices: { createPreview, },
        };
        q.mockImplementation(async (sql: string,) => sql.includes('FROM subscriptions WHERE user_id',)
            ? { rows: [{ id: 's1', plan_id: 'club', stripe_subscription_id: 'sub_1', status: 'active', current_period_end: null, cancel_at_period_end: false, },], }
            : sql.includes('SELECT stripe_price_id FROM subscription_plans',) ? { rows: [{ stripe_price_id: 'price_club', },], } : { rows: [], },);
        const res = await preview('u1', 'club', 'price_club_year',);
        expect(res.direction,).toBe('billing',);
        expect(createPreview,).toHaveBeenCalled();
        stripe = null;
        for (const k of Object.keys(prices,)) delete prices[k];
    },);
},);

describe('levels hidden from the subscription tiers', () => {
    beforeEach(() => { tiers = [...tiers, tier('hidden', { hiddenFromTiers: true, devOnly: true, sortOrder: 0, },),]; },);

    it('are hidden from every viewer (admins included) and refused for self-service', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('SELECT role FROM users',) ? { rows: [{ role: 'admin', },], } : { rows: [], },);
        can.mockResolvedValue(true,);
        expect((await publicTiers('u1',)).tiers.some((t,) => t.id === 'hidden',),).toBe(false,);
        expect((await publicTiers(null,)).tiers.some((t,) => t.id === 'hidden',),).toBe(false,);
        await expect(preview('u1', 'hidden',),).rejects.toThrow(/not found/i,);
    },);

    it('still show for a member already on the level', async () => {
        currentTier = tiers.find((t,) => t.id === 'hidden',)!;
        const cat = await publicTiers('u1',);
        expect(cat.tiers.map((t,) => t.id,),).toContain('hidden',);
        currentTier = null;
    },);
},);

describe('subscription-required mode', () => {
    it('hides Free and refuses a level below the minimum', async () => {
        policy.required = true;
        policy.minimumRank = 2;
        tiers = [...tiers, tier('gold', { sortOrder: 2, priceCents: 5000, },),];
        const cat = await publicTiers(null,);
        expect(cat.tiers.map((t,) => t.id,),).toEqual(['gold',],);
        await expect(preview('u1', 'basic',),).rejects.toThrow(/not available/,);
    },);
},);
