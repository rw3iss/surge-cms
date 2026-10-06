/**
 * The generic reply procedure: recipient always from the stored record,
 * visitor values escaped, `{{reply.*}}` + source objects in the context,
 * Default Template vs a Mailing Lists template, one retry on a thrown send.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const C = '11111111-1111-1111-1111-111111111111';
const D = '22222222-2222-2222-2222-222222222222';
const F = '33333333-3333-3333-3333-333333333333';
const S = '44444444-4444-4444-4444-444444444444';

let donationRow: Record<string, unknown> | null = null;
let submissionRow: Record<string, unknown> | null = null;
const queries: unknown[][] = [];
vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[],) => {
        queries.push(params,);
        if (sql.includes('FROM donations',)) return { rows: donationRow ? [donationRow,] : [], };
        if (sql.includes('FROM form_submissions',)) return { rows: submissionRow ? [submissionRow,] : [], };
        return { rows: [], };
    },
}),);
vi.mock('../../repositories/forms.repo', () => ({
    findQuestionsByFormId: async () => [
        { id: 'q1', question: 'Email', type: 'email', },
        { id: 'q2', question: 'First name (optional)', type: 'text', },
        { id: 'q3', question: 'Your tip', type: 'textarea', },
    ],
}),);
const sent: Array<Record<string, unknown>> = [];
let failTimes = 0;
vi.mock('../email', () => ({
    sendEmail: async (msg: Record<string, unknown>,) => {
        if (failTimes > 0) {
            failTimes -= 1;
            throw new Error('SMTP timeout',);
        }
        sent.push(msg,);
    },
}),);
vi.mock('../mail/sender', () => ({ resolveSender: async () => ({ fromName: 'Surge', fromEmail: 'noreply@x.co', }), }),);
vi.mock('../mail/siteContext', () => ({
    loadMailRenderContext: async () => ({ siteName: 'Surge Media', siteUrl: 'https://surgemedia.us', siteSettings: { logo: 'https://cdn/x.png', }, }),
}),);
// A minimal {{ path }} resolver — the real engine is covered by its own tests.
vi.mock('../mail/templateRuntime', () => ({
    resolveMailTemplate: async (tpl: string, ctx: Record<string, unknown>,) =>
        tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m: string, p: string,) => {
            const v = p.split('.',).reduce<unknown>((o, k,) => (o as Record<string, unknown> | undefined)?.[k], ctx,);
            return v == null ? '' : String(v,);
        },),
}),);
let enabled: Record<string, boolean> = {};
vi.mock('../settings', () => ({ isFeatureEnabledServer: async (k: string,) => enabled[k] ?? false, }),);
const rendered: Array<{ id: string; ctx: Record<string, unknown>; }> = [];
let templateSource = '<td>{{reply.message}}</td>';
vi.mock('../mailTemplates', () => ({
    renderForRecipient: async (id: string, opts: { subject?: string; context: Record<string, unknown>; },) => {
        rendered.push({ id, ctx: opts.context, },);
        return { subject: opts.subject ?? '', html: `<td>${(opts.context.reply as { message: string; }).message}</td>`, source: templateSource, };
    },
}),);
const audit = vi.fn();
vi.mock('../audit', () => ({ logAudit: (...a: unknown[]) => audit(...a,), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), }, }),);

const svc = await import('./index');
const CTX = { userId: 'u1', ipAddress: '', userAgent: '', };
const DREF = { campaignId: C, donationId: D, };

beforeEach(() => {
    donationRow = {
        id: D, campaign_id: C, donor_name: 'Dana <b>Smith</b>', donor_email: 'donor@x.co', amount_cents: 5500,
        message: 'Go!', visibility: 'public', status: 'succeeded', campaign_title: 'Winter Drive', campaign_slug: 'winter',
    };
    submissionRow = {
        id: S, user_id: null, submitted_at: '2026-10-06T00:00:00Z', form_title: 'Submit a Tip', form_slug: 'tip', user_email: null,
        answers: [{ questionId: 'q1', value: 'tipster@x.co', }, { questionId: 'q2', value: 'Ann', }, { questionId: 'q3', value: 'Big story', },],
    };
    enabled = { campaigns: true, forms: true, mailing_lists: true, };
    queries.length = 0;
    sent.length = 0;
    rendered.length = 0;
    failTimes = 0;
    audit.mockClear();
},);

describe('Default Template', () => {
    const LAYOUT = { siteName: 'Surge Media', siteUrl: 'https://surgemedia.us', logoUrl: 'https://surgemedia.us/logo.png', };

    it('puts the logo, linked home, above and below the message', () => {
        const html = svc.renderDefaultReply('<p>Thanks!</p>', LAYOUT,);
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
        const html = svc.renderDefaultReply('x', { ...LAYOUT, logoUrl: null, },);
        expect(html,).not.toContain('<img',);
        expect(html,).toContain('>Surge Media</a>',);
    },);
},);

describe('donation source', () => {
    it("always emails the donation's own address, scoped to the campaign", async () => {
        const res = await svc.send('donation', { ref: DREF, subject: 'Hello', message: 'Thank you', }, CTX,);
        expect(queries[0],).toEqual([D, C,],);
        expect(sent[0],).toMatchObject({ to: 'donor@x.co', subject: 'Hello', },);
        expect(res,).toEqual({ sent: true, to: 'donor@x.co', },);
        expect(audit,).toHaveBeenCalledWith(expect.objectContaining({ action: 'donation_reply', entityId: D, },),);
    },);

    it('404s a donation from another campaign', async () => {
        donationRow = null;
        await expect(svc.send('donation', { ref: DREF, subject: 'x', message: 'y', }, CTX,),).rejects.toThrow(/not found/i,);
        expect(sent,).toHaveLength(0,);
    },);

    it('retries once on a transient failure', async () => {
        failTimes = 1;
        await svc.send('donation', { ref: DREF, subject: 'x', message: 'y', }, CTX,);
        expect(sent,).toHaveLength(1,);
    },);

    it('reports a failure after the retry, without auditing a send', async () => {
        failTimes = 2;
        await expect(svc.send('donation', { ref: DREF, subject: 'x', message: 'y', }, CTX,),).rejects.toThrow(/could not be sent: SMTP timeout/,);
        expect(audit,).not.toHaveBeenCalled();
    },);

    it('resolves {{ }} in the message, escaping the donor-supplied values', async () => {
        const res = await svc.preview('donation', { ref: DREF, subject: 'Thanks {{donation.name}}', message: 'Hi {{donation.name}}, ${{donation.amount}}', },);
        expect(res.subject,).toBe('Thanks Dana <b>Smith</b>',); // a header: raw text
        expect(res.html,).toContain('Hi Dana &lt;b&gt;Smith&lt;/b&gt;, $55.00',);
        expect(res.html,).not.toContain('<b>Smith',);
        expect(sent,).toHaveLength(0,);
    },);

    it('lists the variables a template can use', async () => {
        const t = await svc.target('donation', DREF,);
        expect(t.to,).toBe('donor@x.co',);
        expect(t.variables,).toEqual(expect.arrayContaining(['reply.message', 'reply.fromEmail', 'donation.amount', 'donation.name', 'campaign.title',],),);
        expect(t.defaultSubject,).toBe('Thank you for supporting Winter Drive',);
    },);
},);

describe('templates', () => {
    it('renders a Mailing Lists template with reply + source objects in the context', async () => {
        const res = await svc.preview('donation', { ref: DREF, templateId: 'tpl-1', subject: 'S', message: 'Line one\n\nLine two', fromName: 'Frank', },);
        expect(rendered[0]!.id,).toBe('tpl-1',);
        const ctx = rendered[0]!.ctx as Record<string, Record<string, unknown>>;
        expect(ctx.reply!.fromName,).toBe('Frank',);
        expect(ctx.reply!.fromEmail,).toBe('noreply@x.co',);
        expect(ctx.donation!.name,).toBe('Dana &lt;b&gt;Smith&lt;/b&gt;',);
        expect(ctx.campaign!.title,).toBe('Winter Drive',);
        expect(res.html,).toContain('<p style="margin:0 0 16px;line-height:1.6">Line one</p>',);
    },);

    it('flags a template that never shows the message', async () => {
        templateSource = '<td>{{site.name}}</td>';
        const res = await svc.preview('donation', { ref: DREF, templateId: 'tpl-2', subject: 'S', message: 'x', },);
        expect(res.messageShown,).toBe(false,);
        templateSource = '<td>{{reply.message}}</td>';
        expect((await svc.preview('donation', { ref: DREF, templateId: 'tpl-2', subject: 'S', message: 'x', },)).messageShown,).toBe(true,);
    },);

    it('refuses a template when Mailing Lists is off', async () => {
        enabled.mailing_lists = false;
        await expect(svc.preview('donation', { ref: DREF, templateId: 'tpl-1', subject: 'S', message: 'x', },),).rejects.toThrow(/Mailing Lists/,);
    },);
},);

describe('submission source', () => {
    const SREF = { formId: F, submissionId: S, };

    it('replies to the email answer, with every field under its key', async () => {
        const t = await svc.target('submission', SREF,);
        expect(t.to,).toBe('tipster@x.co',);
        expect(t.toName,).toBe('Ann',);
        expect(t.variables,).toEqual(expect.arrayContaining(['submission.your_tip', 'submission.email', 'form.title',],),);
        expect(t.variables.some((v,) => v.startsWith('submission.answers',)),).toBe(false,);
        const res = await svc.preview('submission', { ref: SREF, subject: 'Re', message: 'About: {{submission.your_tip}}', },);
        expect(res.html,).toContain('About: Big story',);
    },);

    it("falls back to a signed-in submitter's account email", async () => {
        submissionRow!.answers = [{ questionId: 'q3', value: 'x', },];
        submissionRow!.user_email = 'member@x.co';
        expect((await svc.target('submission', SREF,)).to,).toBe('member@x.co',);
    },);

    it('refuses a submission with no address', async () => {
        submissionRow!.answers = [{ questionId: 'q3', value: 'x', },];
        await expect(svc.target('submission', SREF,),).rejects.toThrow(/no email address/,);
    },);

    it('is off when the forms feature is off', async () => {
        enabled.forms = false;
        await expect(svc.target('submission', SREF,),).rejects.toThrow(/forms feature/,);
    },);
},);

it('rejects an unknown source and a malformed ref', async () => {
    await expect(svc.target('nope', {},),).rejects.toThrow(/not found/i,);
    await expect(svc.target('donation', { campaignId: 'x', donationId: D, },),).rejects.toThrow(/ref.campaignId/,);
},);
