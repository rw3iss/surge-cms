/**
 * Public list sign-up abuse guards (audit 2026-10-18 S8): a filled honeypot
 * stores nothing yet answers like a real sign-up, and the public endpoint is
 * rate-limited per IP (internal callers — a form's subscribe action — are not).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const findBySlug = vi.fn();
const findByEmail = vi.fn();
const create = vi.fn();
const rateLimit = vi.fn();

vi.mock('../repositories/mailingLists.repo', () => ({ findBySlug: (...a: unknown[]) => findBySlug(...a,), }),);
vi.mock('../repositories/mailingListSubscribers.repo', () => ({
    findByEmail: (...a: unknown[]) => findByEmail(...a,),
    create: (...a: unknown[]) => create(...a,),
}),);
vi.mock('./discussions/spam', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a,), }),);
vi.mock('./mail/listSignupNotice', () => ({ sendListSignupNotice: vi.fn(), }),);
vi.mock('./email', () => ({ sendEmail: vi.fn(), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), delPattern: vi.fn(), }, }),);

import { publicSubscribe, SUBSCRIBE_IP_LIMIT, } from './mailingLists';

beforeEach(() => {
    vi.clearAllMocks();
    findBySlug.mockResolvedValue({ id: 'l1', slug: 'news', name: 'News', isEnabled: true, doubleOptIn: false, },);
    findByEmail.mockResolvedValue(null,);
    create.mockResolvedValue({ id: 's1', status: 'subscribed', },);
    rateLimit.mockResolvedValue(undefined,);
},);

describe('publicSubscribe', () => {
    it('a filled honeypot stores nothing but answers like a sign-up', async () => {
        const res = await publicSubscribe('news', { email: 'bot@x.io', website: 'http://spam', }, { ip: '1.2.3.4', },);
        expect(res.status,).toBe('subscribed',);
        expect(create,).not.toHaveBeenCalled();
        expect(findByEmail,).not.toHaveBeenCalled();
    },);

    it('rate-limits the public endpoint per IP', async () => {
        await publicSubscribe('news', { email: 'a@x.io', }, { ip: '1.2.3.4', },);
        expect(rateLimit,).toHaveBeenCalledWith('ip:1.2.3.4:sub', SUBSCRIBE_IP_LIMIT.max, SUBSCRIBE_IP_LIMIT.windowSeconds,);
        expect(create,).toHaveBeenCalled();
    },);

    it('a refused limit stops the sign-up', async () => {
        rateLimit.mockRejectedValue(new Error('Too many requests',),);
        await expect(publicSubscribe('news', { email: 'a@x.io', }, { ip: '1.2.3.4', },),).rejects.toThrow();
        expect(create,).not.toHaveBeenCalled();
    },);

    it('internal callers (no ip) are not limited', async () => {
        await publicSubscribe('news', { email: 'a@x.io', }, {},);
        expect(rateLimit,).not.toHaveBeenCalled();
    },);
},);
