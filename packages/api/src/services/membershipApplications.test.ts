import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./email', () => ({ sendEmail: vi.fn(async () => ({}),), }),);
vi.mock('./notifications', () => ({ notify: vi.fn(), }),);
vi.mock('./forms', () => ({ getById: vi.fn(), submit: vi.fn(), }),);
const startApproved = vi.fn();
vi.mock('./membership', () => ({
    pendingApplicationFor: vi.fn(async () => null,),
    startApprovedMembership: (...a: unknown[]) => startApproved(...a),
}),);
const stripe = { paymentMethods: { retrieve: vi.fn(), }, };
vi.mock('./payment/stripe', () => ({ getStripeClient: () => stripe, }),);

import { ValidationError, } from '../core/errors';
import { apply, approve, } from './membershipApplications';

const USER = '11111111-1111-4111-8111-111111111111';
const TIER = '22222222-2222-4222-8222-222222222222';
const ctx = { userId: USER, email: 'a@b.co', ipAddress: '1.1.1.1', };

/** Route SQL by a fragment → rows. */
function db(map: Array<[string, unknown[]]>,) {
    q.mockImplementation(async (sql: string,) => {
        const hit = map.find(([frag,],) => sql.includes(frag,));
        return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0, };
    },);
}

const tierRow = { id: TIER, name: "Founder's Club", is_free: false, requires_approval: true, application_form_id: null, stripe_price_id: 'price_1', };

beforeEach(() => {
    q.mockReset();
    startApproved.mockReset();
    stripe.paymentMethods.retrieve.mockReset();
},);

describe('apply (built-in form)', () => {
    it('refuses a level that does not require approval', async () => {
        db([['FROM subscription_plans WHERE id', [{ ...tierRow, requires_approval: false, },],],],);
        await expect(apply({ tierId: TIER, answers: [], paymentMethodId: 'pm_1', }, ctx,),).rejects.toThrow(/does not take applications/,);
    },);

    it('refuses a card that is not on the member\'s Stripe customer', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['stripe_customer_id AS customer', [{ customer: 'cus_mine', },],],
        ],);
        stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_someone_else', },);
        await expect(apply({ tierId: TIER, answers: [], paymentMethodId: 'pm_1', }, ctx,),).rejects.toThrow(/enter your card again/,);
    },);

    it('requires every built-in field', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['stripe_customer_id AS customer', [{ customer: 'cus_mine', },],],
        ],);
        stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_mine', },);
        const answers = [{ questionId: 'name', value: 'Ann', }, { questionId: 'email', value: 'a@b.co', },];
        await expect(apply({ tierId: TIER, answers, paymentMethodId: 'pm_1', }, ctx,),).rejects.toThrow(/Phone number is required/,);
    },);

    it('records a pending application with labelled answers and marks the user pending', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['stripe_customer_id AS customer', [{ customer: 'cus_mine', },],],
            ['INSERT INTO membership_applications', [{ id: 'app1', created_at: new Date('2026-10-13T00:00:00Z',), },],],
        ],);
        stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_1', customer: 'cus_mine', },);
        const answers = ['name', 'email', 'phone', 'occupation',].map((id,) => ({ questionId: id, value: id === 'email' ? 'a@b.co' : `x-${id}`, }),);
        const res = await apply({ tierId: TIER, answers, paymentMethodId: 'pm_1', }, ctx,);
        expect(res.application,).toMatchObject({ id: 'app1', status: 'pending', tierName: "Founder's Club", },);
        const insert = q.mock.calls.find(([sql,],) => String(sql,).includes('INSERT INTO membership_applications',),)!;
        expect(JSON.parse(insert[1][4] as string,),).toEqual([
            { label: 'Name', value: 'x-name', }, { label: 'Email', value: 'a@b.co', },
            { label: 'Phone number', value: 'x-phone', }, { label: 'Occupation', value: 'x-occupation', },
        ],);
        expect(q.mock.calls.some(([sql, p,],) => String(sql,).includes('approval_status',) && (p as unknown[])[1] === 'pending',),).toBe(true,);
    },);
},);

describe('approve', () => {
    it('keeps the application pending and stores the error when the charge fails', async () => {
        db([['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: 'pm_1', },],],],);
        startApproved.mockRejectedValue(new ValidationError('The card could not be charged: declined',),);
        await expect(approve('app1', undefined, { userId: 'admin', } as never,),).rejects.toThrow(/declined/,);
        const sqls = q.mock.calls.map(([sql,],) => String(sql,),);
        expect(sqls.some((s,) => s.includes('SET error = $2',),),).toBe(true,);
        expect(sqls.some((s,) => s.includes("status = 'approved'",),),).toBe(false,);
    },);

    it('refuses an application that was already decided', async () => {
        db([['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'rejected', payment_method_id: null, },],],],);
        await expect(approve('app1', undefined, { userId: 'admin', } as never,),).rejects.toThrow(/already rejected/,);
        expect(startApproved,).not.toHaveBeenCalled();
    },);
},);
