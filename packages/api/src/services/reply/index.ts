/**
 * The generic reply procedure: answer a person who reached out (a donor, a
 * form submitter, …) with one email, from the admin.
 *
 *   target(source, ref)        → recipient + defaults + the variable list
 *   preview(source, input)     → the exact HTML that `send` would deliver
 *   send(source, input, ctx)   → sends (one retry on a thrown send), audits
 *
 * Rendering (`renderReply`) is shared by preview and send, so the preview is
 * what ships. Template choice: none → the built-in Default Template; else a
 * Mailing Lists template through the same email render pass the template
 * editor's preview uses (block styles inlined, components/entities expanded,
 * links absolutised). Both resolve `{{ }}` against:
 *
 *   reply.*   fromName, fromEmail, subject, message (HTML paragraphs),
 *             messageText (escaped plain text), to, toName, date
 *   <source>  the record's own objects — donation + campaign, submission + form
 *   site.*    the site variables every mail gets
 *
 * Source values are visitor-supplied, so they are HTML-escaped for the body;
 * the subject is resolved against the raw values (it is a header, not HTML).
 * The typed message may use `{{ }}` too ("Hi {{donation.name}}").
 */
import { buildSiteVariables, } from '@sitesurge/types';
import { randomUUID, } from 'crypto';
import type {
    ReplyComposeBody, ReplyDelivery, ReplyEvent, ReplyRecord, ReplySourceKey, ReplySummaryResponse, ReplyTargetResponse,
} from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';
import { escapeHtml, } from '../../utils/html';
import { logger, } from '../../utils/logger';
import { logAudit, } from '../audit';
import { sendEmail, } from '../email';
import { resolveSender, } from '../mail/sender';
import { loadMailRenderContext, } from '../mail/siteContext';
import { resolveMailTemplate, } from '../mail/templateRuntime';
import * as mailTemplates from '../mailTemplates';
import { isFeatureEnabledServer, } from '../settings';
import type { AuditContext, } from '../types';
import { messageToHtml, renderDefaultReply, replyLayout, } from './defaultTemplate';
import { getSource, type ReplySource, type ReplyTarget, } from './sources';
import * as tracking_ from './tracking';

export { messageToHtml, renderDefaultReply, } from './defaultTemplate';

/** Deep-escape every string (dates/numbers pass through) for the HTML body. */
function escapeDeep(v: unknown,): unknown {
    if (typeof v === 'string') return escapeHtml(v,);
    if (Array.isArray(v,)) return v.map(escapeDeep,);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        return Object.fromEntries(Object.entries(v,).map(([k, x,],) => [k, escapeDeep(x,),]),);
    }
    return v;
}

/** Every leaf path of the template objects, for the "available variables" list. */
function variablePaths(obj: Record<string, unknown>, prefix = '',): string[] {
    const out: string[] = [];
    for (const [k, v,] of Object.entries(obj,)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v,) && !(v instanceof Date)) out.push(...variablePaths(v as Record<string, unknown>, path,));
        else out.push(path,);
    }
    return out;
}

const REPLY_KEYS = ['fromName', 'fromEmail', 'subject', 'message', 'messageText', 'to', 'toName', 'date',];

async function authorize(source: ReplySource,): Promise<void> {
    if (!(await isFeatureEnabledServer(source.feature as never,))) {
        throw new ValidationError(`The ${source.feature} feature is not enabled.`,);
    }
}

export async function target(sourceKey: ReplySourceKey | string, ref: Record<string, string>,): Promise<ReplyTargetResponse> {
    const source = getSource(sourceKey,);
    await authorize(source,);
    const t = await source.load(ref,);
    return {
        to: t.to,
        toName: t.toName,
        title: t.title,
        defaultSubject: t.defaultSubject,
        defaultMessage: t.defaultMessage,
        variables: [...REPLY_KEYS.map((k,) => `reply.${k}`), ...variablePaths(t.vars,), 'site.name', 'site.url',],
    };
}

/** The sender a reply starts with (site default sender → EMAIL_FROM). */
export async function defaultSender(): Promise<{ fromName: string; fromEmail: string; }> {
    const s = await resolveSender();
    return { fromName: s.fromName ?? '', fromEmail: s.fromEmail, };
}

/** Render a reply exactly as it will be sent. */
export async function renderReply(t: ReplyTarget, input: ReplyComposeBody,): Promise<{ subject: string; html: string; messageShown: boolean; }> {
    const sender = await defaultSender();
    const fromName = input.fromName?.trim() || sender.fromName;
    const fromEmail = input.fromEmail?.trim() || sender.fromEmail;
    const renderCtx = await loadMailRenderContext();
    const site = buildSiteVariables({ ...renderCtx.siteSettings, siteName: renderCtx.siteName, }, renderCtx.siteUrl,);

    // Raw context first: the typed subject + message may themselves use {{ }}.
    const rawReply = { fromName, fromEmail, to: t.to, toName: t.toName ?? '', date: new Date(), };
    const textCtx: Record<string, unknown> = { ...t.vars, site, reply: rawReply, };
    const subject = (await resolveMailTemplate(input.subject ?? '', textCtx,)).trim();
    const messageText = await resolveMailTemplate(input.message ?? '', textCtx,);

    const reply = {
        ...(escapeDeep(rawReply,) as Record<string, unknown>),
        subject: escapeHtml(subject,),
        message: messageToHtml(messageText,),
        messageText: escapeHtml(messageText,),
    };
    const htmlCtx: Record<string, unknown> = { ...(escapeDeep(t.vars,) as Record<string, unknown>), site, reply, };

    if (input.templateId) {
        if (!(await isFeatureEnabledServer('mailing_lists',))) {
            throw new ValidationError('Email templates need the Mailing Lists feature — use the Default Template.',);
        }
        const out = await mailTemplates.renderForRecipient(input.templateId, { subject, context: htmlCtx, },);
        // A template without {{reply.message}} silently drops the typed message —
        // flagged so the modal can say so before anything is sent.
        return { subject: out.subject || subject, html: out.html, messageShown: /\breply\.message(Text)?\b/.test(out.source,), };
    }
    return { subject, html: renderDefaultReply(reply.message, await replyLayout(),), messageShown: true, };
}

export async function preview(sourceKey: string, input: ReplyComposeBody,) {
    const source = getSource(sourceKey,);
    await authorize(source,);
    const t = await source.load(input.ref,);
    const out = await renderReply(t, input,);
    return { to: t.to, subject: out.subject, html: out.html, messageShown: out.messageShown, };
}

const sleep = (ms: number,) => new Promise((r,) => setTimeout(r, ms,),);

/**
 * Send. One retry after a short pause covers a transient SMTP blip; a retry
 * only runs when the first attempt THREW (nothing was accepted), so it cannot
 * double-send. A final failure is re-thrown so the admin sees it.
 */
export async function send(sourceKey: string, input: ReplyComposeBody, ctx: AuditContext,) {
    if (!input.subject?.trim()) throw new ValidationError('A subject is required.',);
    if (!input.message?.trim()) throw new ValidationError('A message is required.',);
    const source = getSource(sourceKey,);
    await authorize(source,);
    const t = await source.load(input.ref,);
    const out = await renderReply(t, input,);
    const msg = {
        to: t.to,
        subject: out.subject,
        html: out.html,
        fromName: input.fromName?.trim() || undefined,
        fromEmail: input.fromEmail?.trim() || undefined,
    };
    // The reply's id exists before the send so the open image, click links and
    // SES tags can carry it. The STORED html stays un-instrumented (viewing it
    // in the admin must not count as an open).
    const replyId = randomUUID();
    const tracking = await tracking_.sendOptions().catch(() => null);
    const outgoing = tracking
        ? { ...msg, html: tracking_.instrument(msg.html, replyId, tracking,), headers: tracking_.sesHeaders(replyId, tracking,), }
        : msg;
    let messageId: string | undefined;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            messageId = (await sendEmail(outgoing,))?.messageId;
            lastErr = undefined;
            break;
        } catch (err) {
            lastErr = err;
            logger.warn('reply send failed', { attempt, source: source.key, error: (err as Error).message, },);
            if (attempt < 2) await sleep(800,);
        }
    }
    // Recorded either way: a failed reply is history too ("we tried, it bounced").
    // Store who it actually came from (the default sender when none was typed).
    const sender = msg.fromName && msg.fromEmail ? null : await defaultSender().catch(() => null);
    const recorded = { ...msg, fromName: msg.fromName ?? sender?.fromName, fromEmail: msg.fromEmail ?? sender?.fromEmail, };
    await record(replyId, source.key, t, input, recorded, lastErr ? (lastErr as Error).message || 'mail server error' : null, ctx.userId, messageId,);
    if (lastErr) throw new Error(`The reply could not be sent: ${(lastErr as Error).message || 'mail server error'}`,);
    await logAudit({
        userId: ctx.userId,
        action: `${source.key}_reply`,
        entityType: t.audit.entityType,
        entityId: t.audit.entityId,
        newValues: { ...t.audit.details, to: t.to, subject: msg.subject, templateId: input.templateId ?? null, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { sent: true as const, to: t.to, replyId, };
}

// ─── Tracking ─────────────────────────────────────────────────────────────

/** Store one reply attempt. Never throws — a failed insert must not hide a sent email. */
async function record(
    id: string, source: string, t: ReplyTarget, input: ReplyComposeBody,
    msg: { subject: string; html: string; fromName?: string; fromEmail?: string; }, error: string | null, userId?: string, messageId?: string,
): Promise<void> {
    try {
        await query(
            `INSERT INTO replies (id, source, subject_id, ref, recipient_email, recipient_name, subject, message, body_html,
                                  template_id, from_name, from_email, status, error, sent_by, message_id)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
                id, source, t.audit.entityId, JSON.stringify(input.ref ?? {},), t.to, t.toName, msg.subject, input.message ?? '', msg.html,
                input.templateId ?? null, msg.fromName ?? null, msg.fromEmail ?? null, error ? 'failed' : 'sent', error, uuidOrNull(userId,),
                tracking_.storedMessageId(messageId,),
            ],
        );
    } catch (err) {
        logger.error('reply: could not record the reply', { source, error: (err as Error).message, },);
    }
}

interface ReplyRow {
    id: string; source: string; subject_id: string; ref: Record<string, string>; recipient_email: string; recipient_name: string | null;
    subject: string; message: string; body_html: string; template_id: string | null; from_name: string | null; from_email: string | null;
    status: 'sent' | 'failed'; error: string | null; sent_by: string | null; sent_by_name: string | null; created_at: Date;
    delivery: ReplyDelivery | null; delivery_detail: string | null; delivered_at: Date | null;
    open_count: number; first_opened_at: Date | null; last_opened_at: Date | null; click_count: number;
}

const iso = (d: Date | null | undefined,) => (d ? new Date(d,).toISOString() : null);

const ROW_SELECT = `SELECT r.*, u.display_name AS sent_by_name FROM replies r LEFT JOIN users u ON u.id = r.sent_by`;

function mapReply(r: ReplyRow,): ReplyRecord {
    return {
        id: r.id,
        source: r.source as ReplyRecord['source'],
        subjectId: r.subject_id,
        ref: r.ref ?? {},
        to: r.recipient_email,
        toName: r.recipient_name,
        subject: r.subject,
        message: r.message,
        html: r.body_html,
        templateId: r.template_id,
        fromName: r.from_name,
        fromEmail: r.from_email,
        status: r.status,
        error: r.error,
        sentBy: r.sent_by ? { id: r.sent_by, name: r.sent_by_name ?? 'Staff', } : null,
        createdAt: new Date(r.created_at,).toISOString(),
        delivery: r.delivery ?? null,
        deliveryDetail: r.delivery_detail ?? null,
        deliveredAt: iso(r.delivered_at,),
        openCount: r.open_count ?? 0,
        firstOpenedAt: iso(r.first_opened_at,),
        lastOpenedAt: iso(r.last_opened_at,),
        clickCount: r.click_count ?? 0,
    };
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Per-record roll-up for a page of table rows (ids with no reply are absent). */
export async function summaries(sourceKey: string, ids: string[],): Promise<ReplySummaryResponse> {
    getSource(sourceKey,);
    const clean = [...new Set(ids.filter((i,) => UUID.test(i,)),),].slice(0, 500,);
    if (!clean.length) return {};
    const r = await query<{
        subject_id: string; count: number; sent_count: number; last_at: Date; last_status: 'sent' | 'failed';
        last_delivery: ReplyDelivery | null; last_opened: boolean;
    }>(
        `SELECT subject_id, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
                MAX(created_at) AS last_at,
                (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_status,
                (ARRAY_AGG(delivery ORDER BY created_at DESC))[1] AS last_delivery,
                (ARRAY_AGG(open_count > 0 ORDER BY created_at DESC))[1] AS last_opened
           FROM replies WHERE source = $1 AND subject_id = ANY($2::uuid[]) GROUP BY subject_id`,
        [sourceKey, clean,],
    );
    const out: ReplySummaryResponse = {};
    for (const row of r.rows) {
        out[row.subject_id] = { count: row.count, sentCount: row.sent_count, lastAt: new Date(row.last_at,).toISOString(), lastStatus: row.last_status,
            lastDelivery: row.last_delivery ?? null, lastOpened: !!row.last_opened,
        };
    }
    return out;
}

/** Every reply to one record, newest first. */
export async function history(sourceKey: string, subjectId: string,): Promise<ReplyRecord[]> {
    getSource(sourceKey,);
    if (!UUID.test(subjectId,)) throw new ValidationError('Invalid id.',);
    const r = await query<ReplyRow>(`${ROW_SELECT} WHERE r.source = $1 AND r.subject_id = $2 ORDER BY r.created_at DESC`, [sourceKey, subjectId,],);
    return withEvents(r.rows.map(mapReply,),);
}

/** One reply (for its permission check, the caller reads `.source`). */
export async function getReply(id: string,): Promise<ReplyRecord> {
    if (!UUID.test(id,)) throw new NotFoundError('Reply',);
    const r = await query<ReplyRow>(`${ROW_SELECT} WHERE r.id = $1`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Reply',);
    return (await withEvents([mapReply(r.rows[0],),],))[0];
}

/** Attach each reply's events (oldest first) in one query. */
async function withEvents(list: ReplyRecord[],): Promise<ReplyRecord[]> {
    if (!list.length) return list;
    const r = await query<{ reply_id: string; type: ReplyEvent['type']; via: ReplyEvent['via']; detail: string | null; created_at: Date; }>(
        `SELECT reply_id, type, via, detail, created_at FROM reply_events WHERE reply_id = ANY($1::uuid[]) ORDER BY created_at`,
        [list.map((x,) => x.id),],
    ).catch(() => ({ rows: [], }),);
    const by = new Map<string, ReplyEvent[]>();
    for (const e of r.rows) {
        const arr = by.get(e.reply_id,) ?? [];
        arr.push({ type: e.type, via: e.via, detail: e.detail, at: new Date(e.created_at,).toISOString(), },);
        by.set(e.reply_id, arr,);
    }
    return list.map((x,) => ({ ...x, events: by.get(x.id,) ?? [], }));
}

/** Permission key for a source — the route checks it before anything else. */
export function permissionFor(sourceKey: string,): string {
    return getSource(sourceKey,).permission;
}
