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
import type { ReplyComposeBody, ReplySourceKey, ReplyTargetResponse, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
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
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            await sendEmail(msg,);
            lastErr = undefined;
            break;
        } catch (err) {
            lastErr = err;
            logger.warn('reply send failed', { attempt, source: source.key, error: (err as Error).message, },);
            if (attempt < 2) await sleep(800,);
        }
    }
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
    return { sent: true as const, to: t.to, };
}

/** Permission key for a source — the route checks it before anything else. */
export function permissionFor(sourceKey: string,): string {
    return getSource(sourceKey,).permission;
}
