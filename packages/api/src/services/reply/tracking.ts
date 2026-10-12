/**
 * Reply tracking, after the send: delivery events from SES, opens, clicks.
 *
 *   Delivery  SES event publishing (a configuration set) → SNS topic → HTTPS
 *             subscription → POST /api/v1/mail-events/ses/:token. Every
 *             message is SNS-signed; we verify the signature, pin the topic
 *             that confirmed the subscription, and require the path token.
 *             An event is matched to its reply by the Message-ID header we
 *             sent (`mail.commonHeaders.messageId`) — SES keeps it unchanged,
 *             including through a Mail Manager relay — or by the `reply_id`
 *             message tag when the configuration set header is honoured.
 *   Opens     a 1×1 GIF at /api/v1/mail-events/o/<replyId>.<sig>.gif. An
 *             open is APPROXIMATE: Apple Mail Privacy Protection loads images
 *             without the reader, and a client that blocks images hides a
 *             real open. The mail client is noted when it can be told.
 *   Clicks    links rewritten to /api/v1/mail-events/c/<replyId>.<sig>?u=<url>;
 *             the signature covers the URL, so the redirect cannot be used to
 *             send anyone anywhere else.
 *
 * The STORED reply HTML is the un-instrumented one: viewing a reply in the
 * admin must not count as an open.
 */
import crypto from 'crypto';
import type { ReplyEventType, ReplyTrackingSettings, ReplyTrackingSettingsBody, ReplyTrackingStatus, } from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { absolutiseUrls, } from '../mail/postProcess';
import { frontendUrl, } from '../mail/recipientContext';
import * as settings from '../settings';
import type { AuditContext, } from '../types';

export const REPLY_TRACKING_KEY = 'reply_tracking';

interface Stored extends ReplyTrackingSettings {
    webhookToken?: string;
    topicArn?: string | null;
    subscriptionConfirmedAt?: string | null;
}

const DEFAULTS: ReplyTrackingSettings = { deliveryEvents: false, configurationSet: '', trackOpens: false, trackClicks: false, };

async function readStored(): Promise<Stored> {
    try {
        return { ...DEFAULTS, ...((await settings.get<Stored>(REPLY_TRACKING_KEY,)) ?? {}), };
    } catch {
        return { ...DEFAULTS, };
    }
}

/** Merge into the stored row without the audit trail (internal state: token, topic). */
async function patchStored(patch: Partial<Stored>,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = site_settings.value || EXCLUDED.value, updated_at = NOW()`,
        [REPLY_TRACKING_KEY, JSON.stringify(patch,),],
    );
}

const newToken = () => crypto.randomBytes(24,).toString('base64url',);

async function ensureToken(s: Stored,): Promise<string> {
    if (s.webhookToken) return s.webhookToken;
    const token = newToken();
    await patchStored({ webhookToken: token, },);
    return token;
}

/** The settings a send needs (no token, no I/O beyond one read). */
export async function sendOptions(): Promise<ReplyTrackingSettings> {
    const s = await readStored();
    return { deliveryEvents: !!s.deliveryEvents, configurationSet: s.configurationSet ?? '', trackOpens: !!s.trackOpens, trackClicks: !!s.trackClicks, };
}

export async function status(): Promise<ReplyTrackingStatus> {
    const s = await readStored();
    const token = await ensureToken(s,);
    const last = await query<{ created_at: Date; type: string; n: number; }>(
        `SELECT (SELECT created_at FROM reply_events WHERE via = 'ses' ORDER BY created_at DESC LIMIT 1) AS created_at,
                (SELECT type FROM reply_events WHERE via = 'ses' ORDER BY created_at DESC LIMIT 1) AS type,
                (SELECT COUNT(*)::int FROM reply_events WHERE via = 'ses' AND created_at > NOW() - INTERVAL '30 days') AS n`,
    ).catch(() => ({ rows: [], }),);
    const row = last.rows[0];
    return {
        deliveryEvents: !!s.deliveryEvents,
        configurationSet: s.configurationSet ?? '',
        trackOpens: !!s.trackOpens,
        trackClicks: !!s.trackClicks,
        webhookUrl: `${frontendUrl()}/api/v1/mail-events/ses/${token}`,
        topicArn: s.topicArn ?? null,
        subscriptionConfirmedAt: s.subscriptionConfirmedAt ?? null,
        lastEventAt: row?.created_at ? new Date(row.created_at,).toISOString() : null,
        lastEventType: row?.type ?? null,
        eventsLast30Days: row?.n ?? 0,
    };
}

export async function update(body: ReplyTrackingSettingsBody, ctx: AuditContext,): Promise<ReplyTrackingStatus> {
    const s = await readStored();
    const next: Stored = {
        ...s,
        ...(body.deliveryEvents !== undefined ? { deliveryEvents: body.deliveryEvents, } : {}),
        ...(body.configurationSet !== undefined ? { configurationSet: body.configurationSet.trim(), } : {}),
        ...(body.trackOpens !== undefined ? { trackOpens: body.trackOpens, } : {}),
        ...(body.trackClicks !== undefined ? { trackClicks: body.trackClicks, } : {}),
    };
    await settings.set(REPLY_TRACKING_KEY, next, ctx,);
    return status();
}

/** New webhook URL; the old one stops working and the topic pin is cleared (re-subscribe). */
export async function rotateToken(): Promise<ReplyTrackingStatus> {
    await patchStored({ webhookToken: newToken(), topicArn: null, subscriptionConfirmedAt: null, },);
    return status();
}

// ─── Signed open/click URLs ────────────────────────────────────────────────

function secret(): string {
    const s = config.jwt.secret;
    if (!s) throw new Error('JWT_SECRET is not set',);
    return s;
}

const sig = (data: string,) => crypto.createHmac('sha256', secret(),).update(data,).digest('base64url',).slice(0, 22,);

function safeEqual(a: string, b: string,): boolean {
    const x = Buffer.from(a,);
    const y = Buffer.from(b,);
    return x.length === y.length && crypto.timingSafeEqual(x, y,);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function openToken(replyId: string,): string {
    return `${replyId}.${sig(`reply-open:${replyId}`,)}`;
}

export function verifyOpenToken(token: string,): string | null {
    const m = /^([0-9a-f-]{36})\.([\w-]{22})(?:\.gif)?$/i.exec(token,);
    if (!m || !UUID.test(m[1],)) return null;
    return safeEqual(m[2], sig(`reply-open:${m[1]}`,),) ? m[1] : null;
}

export function clickToken(replyId: string, url: string,): string {
    return `${replyId}.${sig(`reply-click:${replyId}:${url}`,)}`;
}

export function verifyClickToken(token: string, url: string,): string | null {
    const m = /^([0-9a-f-]{36})\.([\w-]{22})$/i.exec(token,);
    if (!m || !UUID.test(m[1],) || !/^https?:\/\//i.test(url,)) return null;
    return safeEqual(m[2], sig(`reply-click:${m[1]}:${url}`,),) ? m[1] : null;
}

const escAttr = (s: string,) => s.replace(/&/g, '&amp;',).replace(/"/g, '&quot;',);
const unescAttr = (s: string,) => s.replace(/&quot;/g, '"',).replace(/&#39;/g, "'",).replace(/&amp;/g, '&',);

/**
 * The HTML that is actually sent: links absolutised, then (per settings)
 * wrapped for click tracking, then the open image appended. Only http(s)
 * links are wrapped — mailto/tel/anchors stay as they are.
 */
export function instrument(html: string, replyId: string, opts: Pick<ReplyTrackingSettings, 'trackOpens' | 'trackClicks'>,): string {
    if (!replyId || (!opts.trackOpens && !opts.trackClicks)) return html;
    const base = frontendUrl();
    if (!base) return html; // no absolute origin to point the image/redirect at
    let out = absolutiseUrls(html, base,);
    if (opts.trackClicks) {
        out = out.replace(/(<a\b[^>]*?\shref=)(["'])(.*?)\2/gi, (whole, pre: string, q: string, raw: string,) => {
            const url = unescAttr(raw.trim(),);
            if (!/^https?:\/\//i.test(url,)) return whole;
            const t = clickToken(replyId, url,);
            const wrapped = `${base}/api/v1/mail-events/c/${t}?u=${encodeURIComponent(url,)}`;
            return `${pre}${q}${escAttr(wrapped,)}${q}`;
        },);
    }
    if (opts.trackOpens) {
        const img = `<img src="${base}/api/v1/mail-events/o/${openToken(replyId,)}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
        out = /<\/body>/i.test(out,) ? out.replace(/<\/body>/i, `${img}</body>`,) : out + img;
    }
    return out;
}

/** SES headers for a reply send (stripped by SES before delivery). */
export function sesHeaders(replyId: string, opts: Pick<ReplyTrackingSettings, 'deliveryEvents' | 'configurationSet'>,): Record<string, string> {
    if (!opts.deliveryEvents) return {};
    const h: Record<string, string> = { 'X-SES-MESSAGE-TAGS': `source=reply, reply_id=${replyId}`, };
    if (opts.configurationSet) h['X-SES-CONFIGURATION-SET'] = opts.configurationSet;
    return h;
}

// ─── Recording ─────────────────────────────────────────────────────────────

const normMessageId = (id: string | undefined | null,) => (id ?? '').trim().replace(/^<|>$/g, '',).toLowerCase();

/** `<abc@host>` → stored form (lower-case, no brackets). */
export function storedMessageId(id: string | undefined | null,): string | null {
    const n = normMessageId(id,);
    return n || null;
}

/**
 * Record one event and update the reply's roll-up. Idempotent on
 * `externalId` (an SNS redelivery changes nothing). Returns false when the
 * event was a duplicate or the reply is unknown.
 */
export async function recordEvent(
    replyId: string, type: ReplyEventType, via: 'ses' | 'pixel' | 'link', detail: string | null, externalId: string | null = null, at?: Date,
): Promise<boolean> {
    const ins = await query<{ id: string; }>(
        `INSERT INTO reply_events (reply_id, type, via, detail, external_id, created_at)
         SELECT $1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()) WHERE EXISTS (SELECT 1 FROM replies WHERE id = $1)
         ON CONFLICT (external_id) DO NOTHING RETURNING id`,
        [replyId, type, via, detail?.slice(0, 1000,) ?? null, externalId, at ?? null,],
    );
    if (!ins.rows[0]) return false;
    const when = at ?? new Date();
    switch (type) {
        case 'delivery':
            // A later bounce/complaint outranks "delivered"; a delivery never overwrites them.
            await query(
                `UPDATE replies SET delivered_at = COALESCE(delivered_at, $2),
                        delivery = CASE WHEN delivery IN ('bounced','complained','rejected') THEN delivery ELSE 'delivered' END
                  WHERE id = $1`,
                [replyId, when,],
            );
            break;
        case 'delay':
            await query(`UPDATE replies SET delivery = 'delayed', delivery_detail = $2 WHERE id = $1 AND delivery IS NULL`, [replyId, detail,],);
            break;
        case 'bounce':
        case 'complaint':
        case 'reject': {
            const d = type === 'bounce' ? 'bounced' : type === 'complaint' ? 'complained' : 'rejected';
            await query(`UPDATE replies SET delivery = $2, delivery_detail = $3 WHERE id = $1`, [replyId, d, detail,],);
            break;
        }
        case 'open':
            await query(
                `UPDATE replies SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, $2), last_opened_at = $2 WHERE id = $1`,
                [replyId, when,],
            );
            break;
        case 'click':
            await query(`UPDATE replies SET click_count = click_count + 1 WHERE id = $1`, [replyId,],);
            break;
        default:
            break;
    }
    return true;
}

/** A readable name for the mail client behind an open, when it can be told. */
export function describeOpener(ua: string | undefined,): string | null {
    const u = (ua ?? '').trim();
    if (!u) return null;
    if (/GoogleImageProxy/i.test(u,)) return 'Gmail';
    if (/YahooMailProxy/i.test(u,)) return 'Yahoo Mail';
    if (/Outlook|Microsoft Office|ms-office/i.test(u,)) return 'Outlook';
    if (/Thunderbird/i.test(u,)) return 'Thunderbird';
    // Apple's privacy proxy fetches with a bare "Mozilla/5.0": often automatic.
    if (u === 'Mozilla/5.0') return 'Apple Mail (privacy proxy, may be automatic)';
    if (/iPhone|iPad|Macintosh/i.test(u,) && /AppleWebKit/i.test(u,) && !/Safari/i.test(u,)) return 'Apple Mail';
    return u.slice(0, 120,);
}

/** The pixel: record an open, collapsing reloads from the same client within a minute. */
export async function recordOpen(token: string, userAgent: string | undefined,): Promise<void> {
    const replyId = verifyOpenToken(token,);
    if (!replyId) return;
    try {
        const client = describeOpener(userAgent,);
        const recent = await query(
            `SELECT 1 FROM reply_events WHERE reply_id = $1 AND type = 'open' AND detail IS NOT DISTINCT FROM $2
               AND created_at > NOW() - INTERVAL '60 seconds' LIMIT 1`,
            [replyId, client,],
        );
        if (recent.rows[0]) return;
        await recordEvent(replyId, 'open', 'pixel', client,);
    } catch (err) {
        logger.warn('reply open: not recorded', { error: (err as Error).message, },);
    }
}

/** The click redirect: the target URL when the token is valid, else null (→ 404, never an open redirect). */
export async function recordClick(token: string, url: string,): Promise<string | null> {
    const replyId = verifyClickToken(token, url,);
    if (!replyId) return null;
    await recordEvent(replyId, 'click', 'link', url,).catch((err,) => logger.warn('reply click: not recorded', { error: (err as Error).message, },));
    return url;
}

// 1×1 transparent GIF.
export const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64',);
