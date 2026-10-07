/**
 * Sent-mail web view: the signed recipient token can't be forged or moved to
 * another job, a private list's sends are invisible to strangers, and
 * `{{user.*}}` / unsubscribe are filled only for the reader they belong to.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../config', () => ({ config: { mail: { unsubscribeSecret: 'test-secret', }, frontendUrl: 'https://site.test', }, }),);
const J = '11111111-1111-1111-1111-111111111111';
const R = '22222222-2222-2222-2222-222222222222';
let job: Record<string, unknown> | null;
let list: Record<string, unknown>;
vi.mock('../../repositories/mailSendJobs.repo', () => ({ findById: async () => job, }),);
vi.mock('../../repositories/mailingLists.repo', () => ({ findById: async () => list, }),);
vi.mock('../../repositories/mailSendRecipients.repo', () => ({
    findInJob: async (_j: string, id: string,) => (id === R ? { id: R, jobId: J, subscriberId: 'sub-1', email: 'reader@x.co', } : null),
}),);
let viewerSub: Record<string, unknown> | null = null;
vi.mock('../../repositories/mailingListSubscribers.repo', () => ({
    findById: async () => ({ id: 'sub-1', listId: 'L', email: 'reader@x.co', name: 'Rita', customFields: {}, status: 'subscribed', }),
    findByEmail: async () => viewerSub,
}),);
vi.mock('./sendWorker', () => ({ siteContext: async () => ({ name: 'Site', url: 'https://site.test', settings: {}, }), }),);
vi.mock('./templateRuntime', () => ({
    resolveMailTemplate: async (tpl: string, ctx: Record<string, unknown>,) =>
        tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m: string, p: string,) => {
            const v = p.split('.',).reduce<unknown>((o, k,) => (o as Record<string, unknown> | undefined)?.[k], ctx,);
            return v == null ? '' : String(v,);
        },),
}),);
vi.mock('../../db', () => ({ query: async () => ({ rows: [], }), }),);

const { viewToken, verifyViewToken, } = await import('./recipientContext');
const archive = await import('./archive');

beforeEach(() => {
    job = {
        id: J, listId: 'L', status: 'completed', subject: 'Hi {{user.name}}', templateWasModified: false,
        renderedHtmlTemplate: '<p>Hi {{user.name}}</p><a href="{{unsubscribe_url}}">u</a><a href="{{mail.viewUrl}}">v</a>',
    };
    list = { id: 'L', name: 'News', slug: 'news', publicArchive: false, doubleOptIn: false, registeredUsersOnly: false, isEnabled: true, };
    viewerSub = null;
},);

describe('view token', () => {
    it('round-trips, and rejects tampering or another job', () => {
        const t = viewToken(J, R,);
        expect(verifyViewToken(J, t,),).toBe(R,);
        expect(verifyViewToken(J, t.replace(R.slice(0, 4,), 'aaaa',),),).toBeNull();
        expect(verifyViewToken('33333333-3333-3333-3333-333333333333', t,),).toBeNull();
        expect(verifyViewToken(J, `${R}.forged`,),).toBeNull();
        expect(verifyViewToken(J, undefined,),).toBeNull();
    },);
},);

describe('viewSentMail', () => {
    it('personalises for the signed recipient, with their unsubscribe + view links', async () => {
        const v = await archive.viewSentMail(J, { token: viewToken(J, R,), },);
        expect(v.personalisedFor,).toBe('recipient',);
        expect(v.subject,).toBe('Hi Rita',);
        expect(v.html,).toContain('Hi Rita',);
        expect(v.html,).toContain('https://site.test/u/',);
        expect(v.html,).toContain(`https://site.test/mail/${J}?r=`,);
    },);

    it('hides a private list from strangers', async () => {
        await expect(archive.viewSentMail(J, {},),).rejects.toThrow(/not found/i,);
        await expect(archive.viewSentMail(J, { token: `${R}.forged`, },),).rejects.toThrow(/not found/i,);
    },);

    it('shows a public archive anonymously, with no reader data', async () => {
        list.publicArchive = true;
        const v = await archive.viewSentMail(J, {},);
        expect(v.personalisedFor,).toBe('anonymous',);
        expect(v.html,).toContain('<p>Hi </p>',);
        expect(v.html,).not.toContain('/u/',);
    },);

    it('renders for signed-in staff as themselves', async () => {
        const v = await archive.viewSentMail(J, { viewer: { email: 'admin@x.co', displayName: 'Ada', staff: true, }, },);
        expect(v.personalisedFor,).toBe('viewer',);
        expect(v.html,).toContain('Hi Ada',);
        expect(v.html,).not.toContain('/u/',);
    },);

    it("lets a signed-in subscriber of the list see it, with their own unsubscribe", async () => {
        viewerSub = { id: 'sub-9', listId: 'L', email: 'm@x.co', name: 'Mo', customFields: {}, status: 'subscribed', };
        const v = await archive.viewSentMail(J, { viewer: { email: 'm@x.co', displayName: 'Member', }, },);
        expect(v.html,).toContain('Hi Mo',);
        expect(v.html,).toContain('https://site.test/u/',);
    },);

    it('never shows an unsent job to the public', async () => {
        job!.status = 'pending';
        list.publicArchive = true;
        await expect(archive.viewSentMail(J, {},),).rejects.toThrow(/not found/i,);
    },);
},);
