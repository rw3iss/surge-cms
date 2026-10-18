/** S8 + S9 — the signup notice is throttled per address and carries RFC 8058 headers. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const sendEmail = vi.fn();
const allowed = vi.fn();
vi.mock('../email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a,), }),);
vi.mock('../discussions/spam', () => ({ allow: (...a: unknown[]) => allowed(...a,), }),);
vi.mock('../settings', () => ({ getMailingListsSettings: async () => ({ signupNotifyEnabled: true, signupNotifyTemplateId: null, defaultFromName: 'S', defaultFromEmail: 's@x.test', }), }),);
vi.mock('../../repositories/mailingLists.repo', () => ({ findById: async () => ({ id: 'l1', name: 'News', description: '', }), }),);
vi.mock('../../repositories/mailingListSubscribers.repo', () => ({ findById: async () => ({ id: 's1', email: 'A@B.co', name: 'Ann', }), }),);
vi.mock('../reply/defaultTemplate', () => ({ renderDefaultReply: (c: string,) => `<html>${c}</html>`, replyLayout: async () => ({}), }),);
vi.mock('../mailTemplates', () => ({ renderForRecipient: vi.fn(), }),);
vi.mock('./siteContext', () => ({ loadMailRenderContext: vi.fn(), }),);
vi.mock('./recipientContext', () => ({ frontendUrl: () => 'https://x.test', }),);
vi.mock('./unsubscribe', () => ({ generateUnsubscribeToken: () => 'tok', }),);
vi.mock('./variables', () => ({ buildVariableContext: () => ({}), }),);

import { sendListSignupNotice, } from './listSignupNotice';

beforeEach(() => { sendEmail.mockReset(); allowed.mockReset(); },);

describe('sendListSignupNotice', () => {
    it('sends List-Unsubscribe AND List-Unsubscribe-Post (S9)', async () => {
        allowed.mockResolvedValue(true,);
        await sendListSignupNotice('l1', 's1',);
        const headers = sendEmail.mock.calls[0][0].headers;
        expect(headers['List-Unsubscribe'],).toBe('<https://x.test/u/tok>',);
        expect(headers['List-Unsubscribe-Post'],).toBe('List-Unsubscribe=One-Click',);
    },);
    it('throttles per lower-cased address and skips once over the limit (S8)', async () => {
        allowed.mockResolvedValue(false,);
        await sendListSignupNotice('l1', 's1',);
        expect(sendEmail,).not.toHaveBeenCalled();
        expect(allowed.mock.calls[0][0],).toBe('notice:addr:a@b.co',);
    },);
},);
