/**
 * `getSubscriptionStatus` exists so a signup prompt can decide whether to show
 * itself. That makes it the one mailing-list read reachable without admin
 * rights, so what it REFUSES to answer matters more than what it returns.
 *
 * The property being pinned: it never reads an address supplied by the caller.
 * If a future change adds an `email` parameter "for convenience", the endpoint
 * silently becomes a membership oracle — anyone could test whether a given
 * person subscribes to a given list, which is exactly what the shop's
 * merchandise signup goes out of its way to prevent by answering identically
 * for a new and an existing address.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const findBySlug = vi.fn();
const findByEmail = vi.fn();

vi.mock('../repositories/mailingLists.repo', () => ({
    findBySlug: (...a: unknown[]) => findBySlug(...a,),
}),);
vi.mock('../repositories/mailingListSubscribers.repo', () => ({
    findByEmail: (...a: unknown[]) => findByEmail(...a,),
}),);
// Pulled in by the module under test; irrelevant here.
vi.mock('./email', () => ({ sendEmail: vi.fn(), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({
    cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), delPattern: vi.fn(), },
}),);

import { getSubscriptionStatus, } from './mailingLists';

const LIST = { id: 'list-1', slug: 'newsletter', name: 'Newsletter', isEnabled: true, };

beforeEach(() => {
    findBySlug.mockReset();
    findByEmail.mockReset();
    findBySlug.mockResolvedValue(LIST,);
},);

describe('getSubscriptionStatus', () => {
    it('answers false for an anonymous caller WITHOUT touching the database', async () => {
        // Short-circuiting before the lookup is the point: an anonymous caller
        // has no identity to ask about, so there is nothing to look up. It also
        // means an unauthenticated flood cannot turn this into a query per
        // request.
        expect(await getSubscriptionStatus('newsletter', {},),).toEqual({ subscribed: false, },);
        expect(findBySlug,).not.toHaveBeenCalled();
        expect(findByEmail,).not.toHaveBeenCalled();
    },);

    it('looks the caller up by their SESSION email, not anything passed in', async () => {
        findByEmail.mockResolvedValue({ id: 's1', status: 'subscribed', },);

        const res = await getSubscriptionStatus(
            'newsletter',
            // A caller trying to smuggle in someone else's address: the extra
            // key is not part of the signature and must have no effect.
            { userEmail: 'me@example.com', email: 'someone.else@example.com', } as { userEmail: string; },
        );

        expect(res,).toEqual({ subscribed: true, },);
        expect(findByEmail,).toHaveBeenCalledWith('list-1', 'me@example.com',);
    },);

    it('treats a pending double-opt-in row as NOT subscribed', async () => {
        // The confirmation email is sitting unclicked in their inbox, so
        // prompting again is the correct thing to do — not a bug.
        findByEmail.mockResolvedValue({ id: 's1', status: 'pending_confirmation', },);
        expect(await getSubscriptionStatus('newsletter', { userEmail: 'me@example.com', },),)
            .toEqual({ subscribed: false, },);
    },);

    it('treats an unsubscribed row as not subscribed', async () => {
        findByEmail.mockResolvedValue({ id: 's1', status: 'unsubscribed', },);
        expect(await getSubscriptionStatus('newsletter', { userEmail: 'me@example.com', },),)
            .toEqual({ subscribed: false, },);
    },);

    it('answers false — not 404 — for an unknown or disabled list', async () => {
        // Both lead a front-end to the same decision (show the prompt). A throw
        // would turn a mis-typed slug into a console error on every page load.
        findBySlug.mockResolvedValue(null,);
        expect(await getSubscriptionStatus('nope', { userEmail: 'me@example.com', },),)
            .toEqual({ subscribed: false, },);

        findBySlug.mockResolvedValue({ ...LIST, isEnabled: false, },);
        expect(await getSubscriptionStatus('newsletter', { userEmail: 'me@example.com', },),)
            .toEqual({ subscribed: false, },);
    },);

    it('answers false when there is no subscriber row at all', async () => {
        findByEmail.mockResolvedValue(null,);
        expect(await getSubscriptionStatus('newsletter', { userEmail: 'me@example.com', },),)
            .toEqual({ subscribed: false, },);
    },);
},);
