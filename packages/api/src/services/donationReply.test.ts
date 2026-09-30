import { beforeEach, describe, expect, it, vi, } from 'vitest';

let donationRow: Record<string, unknown> | null = null;
const queries: unknown[][] = [];
vi.mock('../db', () => ({
    query: async (_sql: string, params: unknown[],) => {
        queries.push(params,);
        return { rows: donationRow ? [donationRow,] : [], };
    },
}),);
const sent: Array<Record<string, unknown>> = [];
let failTimes = 0;
vi.mock('./email', () => ({
    sendEmail: async (msg: Record<string, unknown>,) => {
        if (failTimes > 0) {
            failTimes -= 1;
            throw new Error('SMTP timeout',);
        }
        sent.push(msg,);
    },
}),);
vi.mock('./mail/sender', () => ({ resolveSender: async () => ({ fromName: 'Surge', fromEmail: 'noreply@x.co', }), }),);
vi.mock('./mail/siteContext', () => ({
    loadMailRenderContext: async () => ({ siteName: 'Surge Media', siteUrl: 'https://surgemedia.us', siteSettings: { logo: 'https://cdn/x.png', }, }),
}),);
const audit = vi.fn();
vi.mock('./audit', () => ({ logAudit: (...a: unknown[]) => audit(...a,), }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

const svc = await import('./donationReply');
const CTX = { userId: 'u1', ipAddress: '', userAgent: '', };
const C = '11111111-1111-1111-1111-111111111111';
const D = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
    donationRow = { donor_email: 'donor@x.co', donor_name: 'Dana', };
    queries.length = 0;
    sent.length = 0;
    failTimes = 0;
    audit.mockClear();
},);

describe('renderDonationReply', () => {
    const LAYOUT = { siteName: 'Surge Media', siteUrl: 'https://surgemedia.us', logoUrl: 'https://surgemedia.us/logo.png', };

    it('puts the logo, linked home, above and below the message', () => {
        const html = svc.renderDonationReply('Thanks!', LAYOUT,);
        const logos = html.match(/<a href="https:\/\/surgemedia\.us"[^>]*><img src="https:\/\/surgemedia\.us\/logo\.png"/g,) ?? [];
        expect(logos,).toHaveLength(2,);
        expect(html.indexOf('Thanks!',),).toBeGreaterThan(html.indexOf('logo.png',),);
        expect(html.lastIndexOf('logo.png',),).toBeGreaterThan(html.indexOf('Thanks!',),);
    },);

    it('escapes the message and keeps its line breaks', () => {
        const html = svc.messageToHtml('Hi <b>Dana</b>,\nline two\n\nSecond para',);
        expect(html,).toContain('Hi &lt;b&gt;Dana&lt;/b&gt;,<br>line two',);
        expect((html.match(/<p /g,) ?? []).length,).toBe(2,);
    },);

    it('falls back to the site name when there is no logo', () => {
        const html = svc.renderDonationReply('x', { ...LAYOUT, logoUrl: null, },);
        expect(html,).not.toContain('<img',);
        expect(html,).toContain('>Surge Media</a>',);
    },);
},);

describe('send', () => {
    it("always emails the donation's own address, scoped to the campaign", async () => {
        const res = await svc.send(C, D, { subject: 'Hello', message: 'Thank you', }, CTX,);
        expect(queries[0],).toEqual([D, C,],);
        expect(sent[0],).toMatchObject({ to: 'donor@x.co', subject: 'Hello', },);
        expect(res,).toEqual({ sent: true, to: 'donor@x.co', },);
        expect(audit,).toHaveBeenCalledTimes(1,);
    },);

    it('404s a donation from another campaign', async () => {
        donationRow = null;
        await expect(svc.send(C, D, { subject: 'x', message: 'y', }, CTX,),).rejects.toThrow(/not found/i,);
        expect(sent,).toHaveLength(0,);
    },);

    it('retries once on a transient failure', async () => {
        failTimes = 1;
        await svc.send(C, D, { subject: 'x', message: 'y', }, CTX,);
        expect(sent,).toHaveLength(1,);
    },);

    it('reports a failure after the retry, without auditing a send', async () => {
        failTimes = 2;
        await expect(svc.send(C, D, { subject: 'x', message: 'y', }, CTX,),).rejects.toThrow(/could not be sent: SMTP timeout/,);
        expect(audit,).not.toHaveBeenCalled();
    },);

    it('preview renders without sending', async () => {
        const res = await svc.preview(C, D, { message: 'Hi', },);
        expect(res.to,).toBe('donor@x.co',);
        expect(res.html,).toContain('https://surgemedia.us/logo.png',);
        expect(sent,).toHaveLength(0,);
    },);
},);
