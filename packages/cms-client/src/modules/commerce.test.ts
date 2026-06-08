import { describe, expect, it, vi, } from 'vitest';
import type {
    MailingListListResponse, ListSubscribeResponse, PaymentsDonateResponse,
    MailSendResponse, MailTemplatePreviewResponse,
} from '@rw/cms-shared';
import { createClient, } from '../index';

function jsonResponse(data: unknown, status = 200,): Response {
    return new Response(JSON.stringify({ success: status < 400, data, },), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

describe('mail + payments modules', () => {
    it('mailingLists.subscribe() POSTs the PUBLIC /lists/:slug/subscribe path (not /mailing-lists)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'subscribed', id: 's1', }, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: ListSubscribeResponse = await cms.mailingLists.subscribe('newsletter', { email: 'a@b.c', },);
        expect(out,).toEqual({ status: 'subscribed', id: 's1', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/lists/newsletter/subscribe',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ email: 'a@b.c', },);
    },);

    it('mailingLists.list() GETs the admin /mailing-lists path', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([],),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: MailingListListResponse = await cms.mailingLists.list();
        expect(out,).toEqual([],);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/mailing-lists',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('payments.donate() POSTs /payments/donate with the body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ clientSecret: 'cs_1', paymentIntentId: 'pi_1', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: PaymentsDonateResponse = await cms.payments.donate({ amountCents: 500, donorEmail: 'a@b.c', },);
        expect(out.paymentIntentId,).toBe('pi_1',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/payments/donate',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ amountCents: 500, donorEmail: 'a@b.c', },);
    },);

    it('mailSend.send() POSTs /mail/send', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ jobId: 'j1', total: 7, }, 202,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: MailSendResponse = await cms.mailSend.send({ listId: 'l1', subject: 'Hi', blocks: [], },);
        expect(out.jobId,).toBe('j1',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/mail/send',);
        expect((init as RequestInit).method,).toBe('POST',);
    },);

    it('mailTemplates.preview() POSTs /mail-templates/preview', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
            html: '<p>x</p>', subject: 'S', detectedVariables: ['name',],
        },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: MailTemplatePreviewResponse = await cms.mailTemplates.preview({ subject: 'S', blocks: [], },);
        expect(out.detectedVariables,).toEqual(['name',],);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/mail-templates/preview',);
        expect((init as RequestInit).method,).toBe('POST',);
    },);
},);
