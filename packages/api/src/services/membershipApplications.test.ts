import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
vi.mock('../config', () => ({ config: { jwt: { secret: 'test-secret', }, }, }),);
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./email', () => ({ sendEmail: vi.fn(async () => ({}),), }),);
const purposeMail = vi.fn(async () => true,);
vi.mock('./mail/purposes', () => ({ sendPurposeMail: (...a: unknown[]) => purposeMail(...a), }),);
vi.mock('./notifications', () => ({ notify: vi.fn(), notifyWith: vi.fn(), }),);
vi.mock('./forms', () => ({ getById: vi.fn(), submit: vi.fn(), }),);
const addRoles = vi.fn(async () => [],);
vi.mock('./users', () => ({ addExtraRoles: (...a: unknown[]) => addRoles(...a), }),);
const inviteFn = vi.fn(async () => ({ result: 'invited', userId: null, invite: null, }),);
vi.mock('./userInvites', () => ({ invite: (...a: unknown[]) => inviteFn(...a), }),);
const startApproved = vi.fn();
vi.mock('./membership', () => ({
    pendingApplicationFor: vi.fn(async () => null,),
    assertTierPrice: vi.fn(async () => undefined,),
    startApprovedMembership: (...a: unknown[]) => startApproved(...a),
}),);
const stripe = { paymentMethods: { retrieve: vi.fn(), }, };
vi.mock('./payment/stripe', () => ({ getStripeClient: () => stripe, }),);

import { ValidationError, } from '../core/errors';
import { apply, approve, attachCard, claimByVerifiedEmail, submit, withdrawOffer, } from './membershipApplications';

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

    it('submit records a pending application with labelled answers and marks the user pending', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['INSERT INTO membership_applications', [{ id: 'app1', created_at: new Date('2026-10-13T00:00:00Z',), },],],
        ],);
        const answers = ['name', 'email', 'phone', 'occupation',].map((id,) => ({ questionId: id, value: id === 'email' ? 'a@b.co' : `x-${id}`, }),);
        const res = await submit({ tierId: TIER, answers, }, ctx,);
        expect(res.application,).toMatchObject({ id: 'app1', status: 'pending', tierName: "Founder's Club", },);
        expect(res.token,).toBeNull();
        const insert = q.mock.calls.find(([sql,],) => String(sql,).includes('INSERT INTO membership_applications',),)!;
        expect(JSON.parse(insert[1][4] as string,),).toEqual([
            { label: 'Name', value: 'x-name', }, { label: 'Email', value: 'a@b.co', },
            { label: 'Phone number', value: 'x-phone', }, { label: 'Occupation', value: 'x-occupation', },
        ],);
        expect(q.mock.calls.some(([sql, p,],) => String(sql,).includes('approval_status',) && (p as unknown[])[1] === 'pending',),).toBe(true,);
    },);
},);

describe('two-step apply, signed out first', () => {
    const answers = ['name', 'email', 'phone', 'occupation',].map((id,) => ({ questionId: id, value: id === 'email' ? 'c@d.co' : `x-${id}`, }),);
    const APP = '33333333-3333-4333-8333-333333333333';

    it('submit without an account returns a claim token and stores the contact email', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['INSERT INTO membership_applications', [{ id: APP, created_at: new Date(), },],],
        ],);
        const res = await submit({ tierId: TIER, answers, }, { userId: null, email: null, ipAddress: '1.1.1.1', },);
        expect(res.token,).toMatch(new RegExp(`^${APP}\\.`,),);
        const insert = q.mock.calls.find(([sql,],) => String(sql,).includes('INSERT INTO membership_applications',),)!;
        expect(insert[1][0],).toBeNull(); // no user yet
        expect(insert[1][5],).toBe('c@d.co',);

        // …then the new account claims it with that token and saves the card.
        q.mockReset();
        db([
            ['FROM membership_applications a', [{ id: APP, user_id: null, plan_id: TIER, status: 'pending', created_at: new Date(), name: "Founder's Club", },],],
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['stripe_customer_id AS customer', [{ customer: 'cus_new', },],],
        ],);
        stripe.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_9', customer: 'cus_new', },);
        const done = await attachCard(USER, { applicationId: APP, token: res.token, paymentMethodId: 'pm_9', },);
        expect(done.application.id,).toBe(APP,);
        const upd = q.mock.calls.find(([sql,],) => String(sql,).includes('SET user_id = $2',),)!;
        expect(upd[1],).toEqual([APP, USER, 'cus_new', 'pm_9',],);
    },);

    it('refuses to claim an account-less application without a valid token', async () => {
        db([['FROM membership_applications a', [{ id: APP, user_id: null, plan_id: TIER, status: 'pending', created_at: new Date(), name: 'x', },],],],);
        await expect(attachCard(USER, { applicationId: APP, token: `${APP}.9999999999.forged`, paymentMethodId: 'pm_9', },),).rejects.toThrow(/Application/,);
        await expect(attachCard(USER, { applicationId: APP, paymentMethodId: 'pm_9', },),).rejects.toThrow(/Application/,);
    },);
},);

const CLAIM: [string, unknown[]] = ['SET approving_at = NOW()', [{ approving_at: new Date('2026-10-18T00:00:00Z',), },],];

describe('approve', () => {
    it('keeps the application pending and stores the error when the charge fails', async () => {
        db([CLAIM, ['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: 'pm_1', },],],],);
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

describe('approve — "hide price" level (no card)', () => {
    it('makes an OFFER: approved, nothing charged, member emailed', async () => {
        db([
            CLAIM,
            ['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: null, price_id: null, },],],
            ['SELECT hide_price, name, role_only, role FROM subscription_plans', [{ hide_price: true, name: "Founder's Club", role_only: false, role: 'subscriber', },],],
            ['FROM membership_applications a', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'approved', tier_name: "Founder's Club", tier_hide_price: true, answers: [], created_at: new Date(), contact_email: 'a@b.co', user_email: 'a@b.co', },],],
        ],);
        const app = await approve('app1', undefined, { userId: 'admin', } as never,);
        expect(startApproved,).not.toHaveBeenCalled();
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes("status = 'approved'",),),).toBe(true,);
        expect(app.tierHidePrice,).toBe(true,);
        // The offer gets an end date.
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes('offer_expires_at = NOW()',),),).toBe(true,);
    },);
},);

describe('approve — claim (no double charge)', () => {
    it('refuses while another approval holds the claim, without charging', async () => {
        db([['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: 'pm_1', },],],],);
        await expect(approve('app1', undefined, { userId: 'admin', } as never,),).rejects.toThrow(/being approved by someone else/,);
        expect(startApproved,).not.toHaveBeenCalled();
    },);

    it('charges with a Stripe idempotency key tied to the claim, then releases it', async () => {
        db([
            CLAIM,
            ['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: 'pm_1', price_id: null, },],],
            ['SELECT hide_price, name FROM subscription_plans', [{ hide_price: false, name: 'Club', },],],
        ],);
        startApproved.mockRejectedValue(new ValidationError('declined',),);
        await expect(approve('app1', undefined, { userId: 'admin', } as never,),).rejects.toThrow();
        expect(startApproved.mock.calls[0][4],).toEqual({ idempotencyKey: `approve:app1:${new Date('2026-10-18T00:00:00Z',).getTime()}`, },);
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes('SET approving_at = NULL',),),).toBe(true,);
    },);
},);

describe('withdrawOffer', () => {
    it('refuses anything but an unstarted approved offer', async () => {
        db([],);
        await expect(withdrawOffer('app1', { userId: 'admin', } as never,),).rejects.toThrow(/Only an approved offer/,);
    },);
},);

describe('submit — anonymous abuse guards', () => {
    const answers = ['name', 'email', 'phone', 'occupation',].map((id,) => ({ questionId: id, value: id === 'email' ? 'x@y.co' : `x-${id}`, }),);
    const anon = { ipAddress: '1.1.1.1', };

    it('honeypot: stores and sends nothing', async () => {
        db([['FROM subscription_plans WHERE id', [tierRow,],],],);
        const res = await submit({ tierId: TIER, answers, website: 'http://spam', }, anon as never,);
        expect(res.application.status,).toBe('pending',);
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes('INSERT',),),).toBe(false,);
    },);

    it('returns the existing pending application for the same email + level', async () => {
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['user_id IS NULL AND status = \'pending\'', [{ id: 'dup1', created_at: new Date(), },],],
        ],);
        const res = await submit({ tierId: TIER, answers, }, anon as never,);
        expect(res.application.id,).toBe('dup1',);
        expect(res.token,).toBeTruthy();
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes('INSERT INTO membership_applications',),),).toBe(false,);
    },);
},);

describe('claimByVerifiedEmail', () => {
    it('attaches one pending + approved account-less rows to the proven user', async () => {
        db([
            ['lower(a.contact_email) = lower($1) AND a.status IN', [{ id: 'p1', status: 'pending', role_only: false, }, { id: 'p2', status: 'pending', role_only: false, }, { id: 'o1', status: 'approved', role_only: false, },],],
            ['SET user_id = $2', [{},],],
        ],);
        const n = await claimByVerifiedEmail(USER, 'x@y.co',);
        expect(n,).toBe(2,);
        const ids = q.mock.calls.filter(([sql,],) => String(sql,).includes('SET user_id = $2',),).map(([, p,],) => (p as string[])[0],);
        expect(ids,).toEqual(['p1', 'o1',],);
    },);
},);

describe('applicant receipt (C3 / U8)', () => {
    it('goes through the editable purpose and carries a claim link for a signed-out applicant', async () => {
        purposeMail.mockClear();
        const answers = ['name', 'email', 'phone', 'occupation',].map((id,) => ({ questionId: id, value: id === 'email' ? 'x@y.co' : `x-${id}`, }),);
        db([
            ['FROM subscription_plans WHERE id', [tierRow,],],
            ['INSERT INTO membership_applications', [{ id: 'new1', created_at: new Date(), },],],
        ],);
        const res = await submit({ tierId: TIER, answers, }, { ipAddress: '1.1.1.1', } as never,);
        await new Promise((r,) => setTimeout(r, 0,),);
        const [key, input,] = purposeMail.mock.calls[0] as [string, { to: string; context: { application: { claimUrl: string; next: string; }; }; }];
        expect(key,).toBe('membership_application_received',);
        expect(input.to,).toBe('x@y.co',);
        expect(input.context.application.claimUrl,).toContain('claim=new1',);
        expect(input.context.application.claimUrl,).toContain(`token=${encodeURIComponent(res.token!,)}`,);
        expect(input.context.application.next,).toMatch(/Create your account/,);
    },);
},);

describe('programs ("Add its role only")', () => {
    it('approval adds the role to a linked account — no membership, no charge', async () => {
        db([
            CLAIM,
            ['FROM membership_applications WHERE id', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'pending', payment_method_id: null, price_id: null, },],],
            ['SELECT hide_price, name, role_only, role FROM subscription_plans', [{ hide_price: true, name: 'Contributor', role_only: true, role: 'contributor', },],],
            ['SELECT a.status, a.activated_at, p.role', [{ status: 'approved', activated_at: null, role: 'contributor', },],],
            ['FROM membership_applications a', [{ id: 'app1', user_id: USER, plan_id: TIER, status: 'approved', tier_name: 'Contributor', tier_hide_price: true, tier_role_only: true, tier_role: 'contributor', answers: [], created_at: new Date(), contact_email: 'a@b.co', user_email: 'a@b.co', },],],
        ],);
        const app = await approve('app1', undefined, { userId: 'admin', } as never,);
        expect(startApproved,).not.toHaveBeenCalled();
        expect(app.tierRoleOnly,).toBe(true,);
        expect(addRoles,).toHaveBeenCalledWith(USER, ['contributor',],);
        expect(q.mock.calls.some(([sql,],) => String(sql,).includes('SET activated_at = NOW()',),),).toBe(true,);
    },);

    it('an approved program found by a verified email is activated (role added) when attached', async () => {
        db([
            ['lower(a.contact_email) = lower($1) AND a.status IN', [{ id: 'g1', status: 'approved', role_only: true, },],],
            ['SET user_id = $2', [{},],],
            ['SELECT a.status, a.activated_at, p.role', [{ status: 'approved', activated_at: null, role: 'contributor', },],],
        ],);
        addRoles.mockClear();
        expect(await claimByVerifiedEmail(USER, 'x@y.co',),).toBe(1,);
        expect(addRoles,).toHaveBeenCalledWith(USER, ['contributor',],);
    },);
});

describe('programs — no account', () => {
    it('approving an account-less program application with no account for its email sends an invite carrying the role', async () => {
        inviteFn.mockClear();
        db([
            CLAIM,
            ['FROM membership_applications WHERE id', [{ id: 'app2', user_id: null, plan_id: TIER, status: 'pending', payment_method_id: null, price_id: null, },],],
            ['SELECT hide_price, name, role_only, role FROM subscription_plans', [{ hide_price: true, name: 'Contributor', role_only: true, role: 'contributor', },],],
            ['FROM users WHERE lower(email)', [],],
            ['FROM membership_applications a', [{ id: 'app2', user_id: null, plan_id: TIER, status: 'pending', tier_name: 'Contributor', tier_hide_price: true, tier_role_only: true, tier_role: 'contributor', answers: [{ label: 'Name', value: 'Jane', },], created_at: new Date(), contact_email: 'jane@x.co', },],],
        ],);
        await approve('app2', undefined, { userId: 'admin', } as never,);
        expect(inviteFn,).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@x.co', roles: ['contributor',], name: 'Jane', },), expect.anything(),);
        expect(startApproved,).not.toHaveBeenCalled();
    },);
});
