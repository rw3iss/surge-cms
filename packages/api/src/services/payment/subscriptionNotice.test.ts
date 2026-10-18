import { beforeEach, describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
vi.mock('../../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('../../config', () => ({ config: { frontendUrl: 'https://site.example', }, }),);

const notifyWith = vi.fn();
vi.mock('../notifications', async (orig,) => ({ ...(await orig<object>()), notifyWith: (...a: unknown[]) => notifyWith(...a), }),);

import { buildSubscriptionNotice, notifySubscriptionChange, } from './subscriptionNotice';

const price = (id: string, cents: number,) => ({ id, unit_amount: cents, currency: 'usd', recurring: { interval: 'month', interval_count: 1, }, product: 'prod_1', });
const sub = (over: Record<string, unknown> = {},) => ({
    id: 'sub_123', status: 'active', cancel_at_period_end: false, metadata: {},
    items: { data: [{ price: price('price_new', 2500,), current_period_end: 1793491200, },], },
    ...over,
}) as never;

beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql: string, params: unknown[] = [],) => {
        if (sql.includes('FROM subscriptions s LEFT JOIN')) return { rows: [{ user_id: 'u1', plan_name: 'Founders', },], };
        if (sql.includes('FROM subscription_plans') && sql.includes('stripe_price_id')) {
            return { rows: [params[0] === 'price_old' ? { id: 'p0', name: 'Basic', } : { id: 'p1', name: 'Founders', },], };
        }
        if (sql.includes('FROM users WHERE id')) {
            return { rows: [{ id: 'u1', email: 'jane@example.com', display_name: 'Jane Doe', first_name: null, last_name: null, role: 'subscriber', extra_roles: [], created_at: new Date('2026-01-02',), },], };
        }
        if (sql.includes('FROM roles WHERE key')) return { rows: [{ key: 'subscriber', label: 'Subscriber', },], };
        if (sql.includes('ce_contact')) return { rows: [{ mobile_phone: '555-0100', primary_phone: null, first_name: null, last_name: null, },], };
        if (sql.includes('FROM subscriptions s JOIN subscription_plans')) {
            return { rows: [{ name: 'Founders', status: 'active', current_period_end: new Date('2026-11-01',), cancel_at_period_end: false, },], };
        }
        return { rows: [], };
    },);
},);

describe('buildSubscriptionNotice', () => {
    it('an incomplete start reads "awaiting payment"', async () => {
        const msg = await buildSubscriptionNotice('created', sub({ status: 'incomplete', },),);
        expect(msg.subject,).toBe('Membership started — awaiting payment — Jane Doe (Founders)',);
        expect(msg.text,).toContain('Status: Awaiting first payment',);
        expect(msg.text,).toContain('Price: $25.00 / month',);
        expect(msg.text,).toContain('Phone: 555-0100',);
        expect(msg.text,).toContain('View member: https://site.example/admin/users/u1',);
        expect(msg.text,).toContain('Open in Stripe: https://dashboard.stripe.com/subscriptions/sub_123',);
    },);

    it('a level change shows old → new', async () => {
        const msg = await buildSubscriptionNotice('updated', sub(), { items: { data: [{ price: price('price_old', 1000,), },], }, } as never,);
        expect(msg.subject,).toBe('Membership changed — Jane Doe (Basic → Founders)',);
        expect(msg.text,).toContain('Level: Basic → Founders',);
    },);

    it('cancel at period end', async () => {
        const msg = await buildSubscriptionNotice('updated', sub({ cancel_at_period_end: true, },), { cancel_at_period_end: false, } as never,);
        expect(msg.subject,).toMatch(/^Membership set to cancel — Jane Doe/,);
        expect(msg.text,).toContain('Cancels at period end: Yes',);
    },);

    it('deleted', async () => {
        const msg = await buildSubscriptionNotice('deleted', sub({ status: 'canceled', },),);
        expect(msg.subject,).toBe('Membership cancelled — Jane Doe (Founders)',);
    },);
},);

describe('notifySubscriptionChange', () => {
    it('stays quiet for an unpaid (incomplete) new attempt', () => {
        notifyWith.mockReset();
        notifySubscriptionChange('created', sub({ status: 'incomplete', },),);
        expect(notifyWith,).not.toHaveBeenCalled();
        notifySubscriptionChange('created', sub(),);
        expect(notifyWith,).toHaveBeenCalledTimes(1,);
    },);

    it('shows role labels, not keys', async () => {
        const msg = await buildSubscriptionNotice('created', sub(),);
        expect(msg.html ?? '',).toContain('Subscriber',);
    },);
},);
