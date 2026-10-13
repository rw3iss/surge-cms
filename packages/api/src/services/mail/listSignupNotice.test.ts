import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── publicSubscribe → notice wiring ─────────────────────────────────
const findBySlug = vi.fn();
const findByEmail = vi.fn();
const create = vi.fn();
const setStatus = vi.fn();
const notice = vi.fn();
vi.mock('../../repositories/mailingLists.repo', () => ({ findBySlug: (...a: unknown[]) => findBySlug(...a,), }),);
vi.mock('../../repositories/mailingListSubscribers.repo', () => ({
    findByEmail: (...a: unknown[]) => findByEmail(...a,),
    create: (...a: unknown[]) => create(...a,),
    setStatus: (...a: unknown[]) => setStatus(...a,),
}),);
vi.mock('./listSignupNotice', async (orig,) => ({ ...(await orig<object>()), sendListSignupNotice: (...a: unknown[]) => notice(...a,), }),);
vi.mock('../email', () => ({ sendEmail: vi.fn(), }),);
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('../cache', () => ({ cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), delPattern: vi.fn(), }, }),);

import { addSubscriber, publicSubscribe, } from '../mailingLists';
import { signupNoticeContent, } from './listSignupNotice';

const LIST = { id: 'list-1', slug: 'news', name: 'Newsletter', isEnabled: true, doubleOptIn: false, registeredUsersOnly: false, };

beforeEach(() => {
    [findBySlug, findByEmail, create, setStatus, notice,].forEach((f,) => f.mockReset(),);
    findBySlug.mockResolvedValue(LIST,);
},);

describe('who gets the "you\'ve been subscribed" notice', () => {
    it('a new subscriber does', async () => {
        findByEmail.mockResolvedValue(null,);
        create.mockResolvedValue({ id: 's1', status: 'subscribed', },);
        await publicSubscribe('news', { email: 'a@b.co', }, {},);
        expect(notice,).toHaveBeenCalledWith('list-1', 's1',);
    },);

    it('someone already on the list does not', async () => {
        findByEmail.mockResolvedValue({ id: 's1', status: 'subscribed', },);
        await publicSubscribe('news', { email: 'a@b.co', }, {},);
        expect(notice,).not.toHaveBeenCalled();
    },);

    it('someone re-joining after unsubscribing does', async () => {
        findByEmail.mockResolvedValue({ id: 's1', status: 'unsubscribed', },);
        await publicSubscribe('news', { email: 'a@b.co', }, {},);
        expect(notice,).toHaveBeenCalledWith('list-1', 's1',);
    },);

    it('a double-opt-in sign-up waits for the confirmation', async () => {
        findBySlug.mockResolvedValue({ ...LIST, doubleOptIn: true, },);
        findByEmail.mockResolvedValue(null,);
        create.mockResolvedValue({ id: 's1', status: 'pending_confirmation', },);
        await publicSubscribe('news', { email: 'a@b.co', }, {},);
        expect(notice,).not.toHaveBeenCalled();
    },);

    it('an admin add does not, unless asked (account sign-up auto-subscribe asks)', async () => {
        findByEmail.mockResolvedValue(null,);
        create.mockResolvedValue({ id: 's2', status: 'subscribed', },);
        await addSubscriber('list-1', { email: 'c@d.co', },);
        expect(notice,).not.toHaveBeenCalled();
        await addSubscriber('list-1', { email: 'c@d.co', }, { notify: true, },);
        expect(notice,).toHaveBeenCalledWith('list-1', 's2',);
    },);
},);

describe('signupNoticeContent', () => {
    it('names the list, escapes values and links the list\'s unsubscribe URL', () => {
        const html = signupNoticeContent(
            { name: 'News <b>', description: '', } as never,
            { name: 'Ann', email: 'a@b.co', } as never,
            'https://x.test/u/tok',
        );
        expect(html,).toContain('News &lt;b&gt;',);
        expect(html,).toContain('href="https://x.test/u/tok"',);
        expect(html,).toContain('Hi Ann,',);
    },);
},);
