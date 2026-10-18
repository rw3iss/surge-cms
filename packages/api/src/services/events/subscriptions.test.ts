import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { mail: { unsubscribeSecret: 'test-secret', }, frontendUrl: 'https://site.test', }, }),);
const upsertSubscriber = vi.fn();
const confirmSubscriber = vi.fn(async () => true);
vi.mock('../../repositories/events.repo', () => ({
    upsertSubscriber: (...a: unknown[]) => upsertSubscriber(...a),
    confirmSubscriber: (...a: unknown[]) => (confirmSubscriber as (...x: unknown[]) => unknown)(...a),
}),);
const sendEmail = vi.fn(async () => undefined);
vi.mock('../email', () => ({ sendEmail: (...a: unknown[]) => (sendEmail as (...x: unknown[]) => unknown)(...a), }),);
vi.mock('./settings', () => ({ eventSender: async () => ({}), }),);
vi.mock('./crud', () => ({ getByIdOrSlug: async () => ({ id: 'e1', title: '<b>Gala</b>', }), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), }, }),);

const { confirmSubscription, confirmToken, subscribe, verifyConfirmToken, } = await import('./subscriptions');

beforeEach(() => {
    upsertSubscriber.mockReset();
    sendEmail.mockClear();
    confirmSubscriber.mockClear();
},);

describe('event subscriptions — double opt-in', () => {
    it('an anonymous subscription is pending and mails ONLY the confirmation link', async () => {
        upsertSubscriber.mockImplementation(async (r: Record<string, unknown>,) => ({ id: 's1', ...r, confirmedAt: null, }));
        const out = await subscribe({ email: 'x@y.test', eventId: 'e1', },);
        expect(upsertSubscriber.mock.calls[0][0],).toMatchObject({ confirmed: false, },);
        expect(out.pendingConfirmation,).toBe(true,);
        expect(sendEmail,).toHaveBeenCalledTimes(1,);
        const html = (sendEmail.mock.calls[0] as unknown as [{ html: string; }])[0].html;
        expect(html,).toContain('/api/v1/events/subscribe/confirm/',);
        expect(html,).not.toContain('<b>Gala</b>',);
    },);

    it('a signed-in subscription counts at once and sends nothing', async () => {
        upsertSubscriber.mockImplementation(async (r: Record<string, unknown>,) => ({ id: 's1', ...r, confirmedAt: '2026-01-01', }));
        const out = await subscribe({ email: 'x@y.test', userId: 'u1', },);
        expect(upsertSubscriber.mock.calls[0][0],).toMatchObject({ confirmed: true, },);
        expect(out.pendingConfirmation,).toBe(false,);
        expect(sendEmail,).not.toHaveBeenCalled();
    },);

    it('the confirm token is signed — a forged one confirms nothing', async () => {
        const t = confirmToken('11111111-1111-1111-1111-111111111111',);
        expect(verifyConfirmToken(t,),).toBe('11111111-1111-1111-1111-111111111111',);
        expect(verifyConfirmToken(t.replace(/.$/, (c,) => (c === 'A' ? 'B' : 'A'),),),).toBeNull();
        expect(verifyConfirmToken('22222222-2222-2222-2222-222222222222.' + t.split('.',)[1],),).toBeNull();
        expect(await confirmSubscription('nope',),).toBe(false,);
        expect(confirmSubscriber,).not.toHaveBeenCalled();
        expect(await confirmSubscription(t,),).toBe(true,);
    },);
},);
