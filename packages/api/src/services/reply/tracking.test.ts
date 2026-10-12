/**
 * Reply tracking: signed open/click URLs, HTML instrumentation, SES event
 * parsing, and the SNS webhook's three checks (token, signature, topic).
 */
import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const R = '0f0e0d0c-0b0a-4908-8706-050403020100';
let stored: Record<string, unknown> = {};
const queries: { sql: string; params: unknown[]; }[] = [];
let replyExists = true;

vi.mock('../../config', () => ({ config: { jwt: { secret: 'test-secret', }, frontendUrl: 'https://site.test', }, }),);
vi.mock('../mail/recipientContext', () => ({ frontendUrl: () => 'https://site.test', }),);
vi.mock('../settings', () => ({ get: async () => stored, set: async () => undefined, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);
vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        queries.push({ sql, params, },);
        if (sql.includes('INSERT INTO reply_events',)) return { rows: replyExists ? [{ id: 'e1', },] : [], };
        if (sql.includes('FROM replies WHERE id',)) return { rows: replyExists ? [{ id: params[0], },] : [], };
        if (sql.includes('FROM replies WHERE message_id',)) return { rows: replyExists ? [{ id: R, },] : [], };
        return { rows: [], };
    },
}),);

const t = await import('./tracking');
const ses = await import('./sesEvents');

beforeEach(() => {
    queries.length = 0;
    replyExists = true;
    stored = { webhookToken: 'tok_abcdefghijklmnopqrstuvwxyz012345', };
},);

describe('signed URLs', () => {
    it('open token round-trips and rejects tampering', () => {
        const tok = t.openToken(R,);
        expect(t.verifyOpenToken(tok,),).toBe(R,);
        expect(t.verifyOpenToken(`${tok}.gif`,),).toBe(R,);
        expect(t.verifyOpenToken(tok.replace(/.$/, (c,) => (c === 'a' ? 'b' : 'a'),),),).toBeNull();
        expect(t.verifyOpenToken('not-a-token',),).toBeNull();
    },);

    it('click token covers the URL, so the redirect cannot be repointed', () => {
        const tok = t.clickToken(R, 'https://site.test/posts/a',);
        expect(t.verifyClickToken(tok, 'https://site.test/posts/a',),).toBe(R,);
        expect(t.verifyClickToken(tok, 'https://evil.test/',),).toBeNull();
        expect(t.verifyClickToken(t.clickToken(R, 'javascript:alert(1)',), 'javascript:alert(1)',),).toBeNull();
    },);
},);

describe('instrument', () => {
    const html = '<html><body><p><a href="/posts/x">Read</a> <a href="mailto:a@b.co">mail</a> <a href="https://ext.test/?a=1&amp;b=2">ext</a></p></body></html>';

    it('does nothing when opens and clicks are off', () => {
        expect(t.instrument(html, R, { trackOpens: false, trackClicks: false, },),).toBe(html,);
    },);

    it('wraps http(s) links (relative ones absolutised first) and leaves mailto alone', () => {
        const out = t.instrument(html, R, { trackOpens: false, trackClicks: true, },);
        expect(out,).toContain(`https://site.test/api/v1/mail-events/c/`,);
        expect(out,).toContain(encodeURIComponent('https://site.test/posts/x',),);
        expect(out,).toContain(encodeURIComponent('https://ext.test/?a=1&b=2',),);
        expect(out,).toContain('href="mailto:a@b.co"',);
    },);

    it('adds the open image before </body>', () => {
        const out = t.instrument(html, R, { trackOpens: true, trackClicks: false, },);
        expect(out,).toMatch(new RegExp(`/api/v1/mail-events/o/${R}\\.[\\w-]{22}\\.gif"[^>]*/></body>`,),);
    },);

    it('SES headers only when delivery events are on', () => {
        expect(t.sesHeaders(R, { deliveryEvents: false, configurationSet: 'x', },),).toEqual({},);
        expect(t.sesHeaders(R, { deliveryEvents: true, configurationSet: 'replies', },),).toEqual({
            'X-SES-MESSAGE-TAGS': `source=reply, reply_id=${R}`, 'X-SES-CONFIGURATION-SET': 'replies',
        },);
    },);
},);

describe('describeOpener', () => {
    it('names common clients', () => {
        expect(t.describeOpener('Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)',),).toBe('Gmail',);
        expect(t.describeOpener('Mozilla/5.0',),).toMatch(/Apple Mail \(privacy proxy/,);
        expect(t.describeOpener('',),).toBeNull();
    },);
},);

describe('parseSesEvent', () => {
    it('reads a bounce with the reply tag', () => {
        const e = ses.parseSesEvent({
            eventType: 'Bounce',
            mail: { commonHeaders: { messageId: '<ABC@host>', }, tags: { reply_id: [R,], }, },
            bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: '2026-10-11T10:00:00Z', bouncedRecipients: [{ diagnosticCode: '550 no such user', },], },
        },);
        expect(e,).toMatchObject({ type: 'bounce', replyId: R, messageId: 'abc@host', detail: 'Hard bounce (General): 550 no such user', },);
    },);

    it('accepts identity notifications and ignores untracked types', () => {
        expect(ses.parseSesEvent({ notificationType: 'Delivery', mail: {}, delivery: {}, },)?.type,).toBe('delivery',);
        expect(ses.parseSesEvent({ eventType: 'Rendering Failure', mail: {}, },),).toBeNull();
    },);
},);

// ─── SNS ─────────────────────────────────────────────────────────────────

const { privateKey, publicKey, } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, },);
ses.__setCertFetcher(async () => publicKey.export({ type: 'spki', format: 'pem', },) as string);

function signed(m: Omit<ses.SnsEnvelope, 'Signature' | 'SignatureVersion' | 'SigningCertURL'>,): ses.SnsEnvelope {
    const env = { ...m, SignatureVersion: '2', SigningCertURL: 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-x.pem', Signature: '', } as ses.SnsEnvelope;
    env.Signature = crypto.createSign('RSA-SHA256',).update(ses.stringToSign(env,),).sign(privateKey, 'base64',);
    return env;
}

const note = (event: unknown, topic = 'arn:aws:sns:us-east-2:1:replies', id = 'm1',) =>
    signed({ Type: 'Notification', MessageId: id, TopicArn: topic, Message: JSON.stringify(event,), Timestamp: '2026-10-11T10:00:00Z', },);

const delivery = { eventType: 'Delivery', mail: { commonHeaders: { messageId: '<x@y>', }, }, delivery: { timestamp: '2026-10-11T10:00:01Z', }, };

describe('SNS webhook', () => {
    it('404s a wrong token before reading anything', async () => {
        const r = await ses.handleSnsWebhook('nope', JSON.stringify(note(delivery,),),);
        expect(r.status,).toBe(404,);
    },);

    it('refuses a bad signature', async () => {
        const m = note(delivery,);
        m.Message = m.Message.replace('Delivery', 'Bounce',);
        const r = await ses.handleSnsWebhook(stored.webhookToken as string, JSON.stringify(m,),);
        expect(r.status,).toBe(403,);
    },);

    it('refuses a cert URL that is not an AWS SNS host', async () => {
        const m = { ...note(delivery,), SigningCertURL: 'https://evil.test/cert.pem', };
        expect(await ses.verifySns(m,),).toBe(false,);
    },);

    it('records a signed delivery against the reply found by Message-ID', async () => {
        const r = await ses.handleSnsWebhook(stored.webhookToken as string, JSON.stringify(note(delivery,),),);
        expect(r,).toEqual({ status: 200, body: 'OK', },);
        const ins = queries.find((q,) => q.sql.includes('INSERT INTO reply_events',),)!;
        expect(ins.params.slice(0, 3,),).toEqual([R, 'delivery', 'ses',],);
        expect(ins.params[4],).toBe('m1',); // SNS MessageId → dedupe key
        expect(queries.some((q,) => q.sql.includes("ELSE 'delivered'",),),).toBe(true,);
    },);

    it('refuses a topic other than the pinned one', async () => {
        stored.topicArn = 'arn:aws:sns:us-east-2:1:replies';
        const r = await ses.handleSnsWebhook(stored.webhookToken as string, JSON.stringify(note(delivery, 'arn:aws:sns:us-east-2:1:other',),),);
        expect(r.status,).toBe(403,);
    },);

    it('answers 200 for an authentic event about mail that is not a reply', async () => {
        replyExists = false;
        const r = await ses.handleSnsWebhook(stored.webhookToken as string, JSON.stringify(note(delivery,),),);
        expect(r,).toEqual({ status: 200, body: 'Ignored (not a reply)', },);
    },);
},);
