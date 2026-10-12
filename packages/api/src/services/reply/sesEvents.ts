/**
 * Inbound SES events over SNS (`POST /api/v1/mail-events/ses/:token`).
 *
 * Three checks, all required, before anything is recorded:
 *   1. the path token matches the stored one (constant time);
 *   2. the SNS signature verifies against an AWS certificate fetched from an
 *      `sns.<region>.amazonaws.com` HTTPS URL (SignatureVersion 1 = SHA1,
 *      2 = SHA256);
 *   3. the topic is the one that confirmed the subscription — the first
 *      confirmed topic is pinned, any other is refused until the token is
 *      rotated.
 *
 * A SubscriptionConfirmation is confirmed automatically (GET SubscribeURL),
 * so the operator only has to create the subscription in AWS.
 *
 * Both event shapes are accepted: configuration-set event publishing
 * (`eventType`) and identity notifications (`notificationType`).
 */
import crypto from 'crypto';
import type { ReplyEventType, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import * as settings from '../settings';
import { recordEvent, REPLY_TRACKING_KEY, storedMessageId, } from './tracking';

export interface SnsEnvelope {
    Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation' | string;
    MessageId: string;
    TopicArn: string;
    Message: string;
    Timestamp: string;
    SignatureVersion: string;
    Signature: string;
    SigningCertURL: string;
    Subject?: string;
    SubscribeURL?: string;
    Token?: string;
}

const AWS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** An AWS SNS URL (cert or subscribe) — https, an sns.<region> host. */
export function isSnsUrl(raw: string | undefined, pem = false,): boolean {
    try {
        const u = new URL(raw ?? '',);
        return u.protocol === 'https:' && AWS_HOST.test(u.hostname,) && (!pem || u.pathname.endsWith('.pem',));
    } catch {
        return false;
    }
}

/** The canonical string SNS signs (field order is fixed by AWS). */
export function stringToSign(m: SnsEnvelope,): string {
    const keys = m.Type === 'Notification'
        ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject',] : []), 'Timestamp', 'TopicArn', 'Type',]
        : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type',];
    return keys.map((k,) => `${k}\n${(m as unknown as Record<string, string>)[k] ?? ''}\n`,).join('',);
}

const certCache = new Map<string, string>();

async function fetchCert(url: string,): Promise<string> {
    const hit = certCache.get(url,);
    if (hit) return hit;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000,), },);
    if (!res.ok) throw new Error(`certificate fetch ${res.status}`,);
    const pem = await res.text();
    if (!pem.includes('BEGIN CERTIFICATE',)) throw new Error('not a certificate',);
    if (certCache.size > 20) certCache.clear();
    certCache.set(url, pem,);
    return pem;
}

/** Test seam: replace the certificate fetcher. */
let certFetcher = fetchCert;
export function __setCertFetcher(fn: typeof fetchCert,) {
    certFetcher = fn;
}

export async function verifySns(m: SnsEnvelope,): Promise<boolean> {
    if (!m?.Signature || !isSnsUrl(m.SigningCertURL, true,)) return false;
    const algo = m.SignatureVersion === '2' ? 'RSA-SHA256' : m.SignatureVersion === '1' ? 'RSA-SHA1' : null;
    if (!algo) return false;
    try {
        const pem = await certFetcher(m.SigningCertURL,);
        return crypto.createVerify(algo,).update(stringToSign(m,), 'utf8',).verify(pem, m.Signature, 'base64',);
    } catch (err) {
        logger.warn('SES webhook: signature check failed', { error: (err as Error).message, },);
        return false;
    }
}

interface Stored {
    webhookToken?: string;
    topicArn?: string | null;
}

function tokenMatches(a: string | undefined, b: string,): boolean {
    if (!a) return false;
    const x = Buffer.from(a,);
    const y = Buffer.from(b,);
    return x.length === y.length && crypto.timingSafeEqual(x, y,);
}

// ─── Parsing an SES event ──────────────────────────────────────────────────

interface SesMail {
    messageId?: string;
    timestamp?: string;
    commonHeaders?: { messageId?: string; };
    headers?: { name: string; value: string; }[];
    tags?: Record<string, string[]>;
}

export interface ParsedSesEvent {
    type: ReplyEventType;
    detail: string | null;
    at: Date | undefined;
    replyId: string | null;
    messageId: string | null;
}

const TYPE_MAP: Record<string, ReplyEventType> = {
    Send: 'send', Delivery: 'delivery', DeliveryDelay: 'delay', Bounce: 'bounce', Complaint: 'complaint', Reject: 'reject', Open: 'open', Click: 'click',
};

const date = (s: unknown,) => (typeof s === 'string' && !Number.isNaN(Date.parse(s,)) ? new Date(s,) : undefined);

/** SES event JSON → what we record. null = an event type we do not track. */
export function parseSesEvent(raw: unknown,): ParsedSesEvent | null {
    const e = raw as Record<string, any>;
    const kind = String(e?.eventType ?? e?.notificationType ?? '',);
    const type = TYPE_MAP[kind];
    if (!type) return null;
    const mail = (e.mail ?? {}) as SesMail;
    const tagId = mail.tags?.reply_id?.[0] ?? null;
    let detail: string | null = null;
    let at: Date | undefined;
    switch (type) {
        case 'delivery':
            at = date(e.delivery?.timestamp,);
            detail = e.delivery?.smtpResponse ? String(e.delivery.smtpResponse,).slice(0, 300,) : null;
            break;
        case 'delay':
            at = date(e.deliveryDelay?.timestamp,);
            detail = e.deliveryDelay?.delayType ? `Delayed: ${e.deliveryDelay.delayType}` : 'Delayed';
            break;
        case 'bounce': {
            const b = e.bounce ?? {};
            at = date(b.timestamp,);
            const r = b.bouncedRecipients?.[0];
            const kindLabel = b.bounceType === 'Transient' ? 'Soft bounce' : b.bounceType === 'Permanent' ? 'Hard bounce' : 'Bounce';
            detail = [kindLabel + (b.bounceSubType ? ` (${b.bounceSubType})` : ''), r?.diagnosticCode,].filter(Boolean,).join(': ',);
            break;
        }
        case 'complaint':
            at = date(e.complaint?.timestamp,);
            detail = e.complaint?.complaintFeedbackType ? `Marked as spam (${e.complaint.complaintFeedbackType})` : 'Marked as spam';
            break;
        case 'reject':
            detail = e.reject?.reason ? `Rejected by SES: ${e.reject.reason}` : 'Rejected by SES';
            break;
        case 'open':
            at = date(e.open?.timestamp,);
            detail = e.open?.userAgent ? String(e.open.userAgent,).slice(0, 200,) : null;
            break;
        case 'click':
            at = date(e.click?.timestamp,);
            detail = e.click?.link ? String(e.click.link,).slice(0, 500,) : null;
            break;
        default:
            at = date(mail.timestamp,);
    }
    return {
        type,
        detail,
        at,
        replyId: tagId && /^[0-9a-f-]{36}$/i.test(tagId,) ? tagId : null,
        messageId: storedMessageId(mail.commonHeaders?.messageId,),
    };
}

async function findReply(ev: ParsedSesEvent,): Promise<string | null> {
    if (ev.replyId) {
        const r = await query<{ id: string; }>(`SELECT id FROM replies WHERE id = $1`, [ev.replyId,],);
        if (r.rows[0]) return r.rows[0].id;
    }
    if (ev.messageId) {
        const r = await query<{ id: string; }>(`SELECT id FROM replies WHERE message_id = $1 ORDER BY created_at DESC LIMIT 1`, [ev.messageId,],);
        if (r.rows[0]) return r.rows[0].id;
    }
    return null;
}

export interface WebhookResult {
    status: number;
    body: string;
}

/**
 * Handle one SNS POST. Always answers quickly; a 2xx for anything that was
 * authentic (even an unknown message), so SNS does not retry it forever.
 */
export async function handleSnsWebhook(token: string, rawBody: string,): Promise<WebhookResult> {
    const stored = (await settings.get<Stored>(REPLY_TRACKING_KEY,).catch(() => null)) ?? {};
    if (!tokenMatches(stored.webhookToken, token,)) return { status: 404, body: 'Not found', };

    let msg: SnsEnvelope;
    try {
        msg = JSON.parse(rawBody,);
    } catch {
        return { status: 400, body: 'Bad request', };
    }
    if (!(await verifySns(msg,))) return { status: 403, body: 'Bad signature', };
    if (stored.topicArn && msg.TopicArn !== stored.topicArn) {
        logger.warn('SES webhook: refused a message from an unexpected topic', { topic: msg.TopicArn, },);
        return { status: 403, body: 'Unexpected topic', };
    }

    if (msg.Type === 'SubscriptionConfirmation') {
        if (!isSnsUrl(msg.SubscribeURL,)) return { status: 400, body: 'Bad subscribe URL', };
        const res = await fetch(msg.SubscribeURL!, { signal: AbortSignal.timeout(8000,), },).catch(() => null);
        if (!res?.ok) return { status: 502, body: 'Could not confirm', };
        await query(
            `UPDATE site_settings SET value = value || $2::jsonb, updated_at = NOW() WHERE key = $1`,
            [REPLY_TRACKING_KEY, JSON.stringify({ topicArn: msg.TopicArn, subscriptionConfirmedAt: new Date().toISOString(), },),],
        );
        logger.info('SES webhook: SNS subscription confirmed', { topic: msg.TopicArn, },);
        return { status: 200, body: 'Confirmed', };
    }
    if (msg.Type !== 'Notification') return { status: 200, body: 'Ignored', };

    let event: unknown;
    try {
        event = JSON.parse(msg.Message,);
    } catch {
        return { status: 200, body: 'Ignored (not JSON)', };
    }
    const parsed = parseSesEvent(event,);
    if (!parsed) return { status: 200, body: 'Ignored (type)', };
    const replyId = await findReply(parsed,);
    if (!replyId) return { status: 200, body: 'Ignored (not a reply)', };
    await recordEvent(replyId, parsed.type, 'ses', parsed.detail, msg.MessageId, parsed.at,);
    return { status: 200, body: 'OK', };
}
