/**
 * Form action dispatch.
 *
 * Runs AFTER a submission is saved (the submission is always recorded, so the
 * action is a side-effect layered on top). Best-effort: any failure is logged
 * and swallowed so it never fails the submitter's request.
 *
 *   - submit    → no-op (the submission row is the whole point).
 *   - subscribe → add the submitter's email to a mailing list (double-opt-in
 *                 aware; gated on the `mailing_lists` feature).
 *   - email     → render To/Subject/Body templates against the submitted field
 *                 values and send via the mail provider.
 *
 * Field variables use the shared `deriveFieldKeys` so the tokens the admin sees
 * in the editor match what resolves here.
 */
import type { Form, FormActionConfig, FormQuestion, TemplateRuntime, } from '@sitesurge/types';
import {
    deriveFieldKeys,
    formatAnswerValue,
    parseEmailList,
    renderTemplateToString,
    resolveValueFunction,
    UNRESOLVED,
} from '@sitesurge/types';
import * as mailingListsRepo from '../repositories/mailingLists.repo';
import { sendEmail, } from './email';
import * as mailingLists from './mailingLists';
import { getPublicSettings, isFeatureEnabledServer, } from './settings';
import { escapeHtml, } from './ssr/blocks/_util';
import { logger, } from '../utils/logger';
import { captureAudience, } from './audienceIntake';
import { formAnswersEmailHtml, formAnswersText, } from './formAnswersEmail';
import { brandedMessage, brandLayout, isFullHtmlDocument, } from './mail/branded';

interface SubmittedAnswer {
    questionId: string;
    value: unknown;
}

export interface FormActor {
    userId?: string;
    userEmail?: string;
}


/** Flatten an answer value to a display string (shared with CSV export). */
const formatValue = formatAnswerValue;

/**
 * Build the flat `{ key: value }` template context from the submitted answers.
 * `escape` HTML-escapes each value (for the HTML email body, since values are
 * untrusted); pass false for plain-text targets (To / Subject).
 */
function buildContext(
    form: Form,
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    escape: boolean,
): Record<string, unknown> {
    const keys = deriveFieldKeys(questions,);
    const enc = (s: string,) => (escape ? escapeHtml(s,) : s);
    const ctx: Record<string, unknown> = {};
    for (const q of questions) {
        const ans = answers.find((a,) => a.questionId === q.id);
        ctx[keys[q.id]] = enc(formatValue(ans?.value,),);
    }
    ctx.form_title = enc(form.title,);
    // A real Date so `{{submitted_at}}` prints a locale date and
    // `{{formatDate(submitted_at)}}` can reformat it.
    ctx.submitted_at = new Date();
    return ctx;
}

/** Value of the first question whose derived key exactly matches `key`. */
function valueByKey(
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    key: string,
): string | null {
    const keys = deriveFieldKeys(questions,);
    // "First name (optional)" derives `first_name_optional`; it is still the
    // first-name field, so the lookup accepts that suffix too.
    const q = questions.find((qq,) => keys[qq.id] === key)
        ?? questions.find((qq,) => keys[qq.id] === `${key}_optional`);
    if (!q) return null;
    const ans = answers.find((a,) => a.questionId === q.id);
    const v = formatValue(ans?.value,).trim();
    return v || null;
}

/** First non-empty value among several candidate derived keys — lets a form
 *  label its fields naturally ("First name" → first_name) and still map to a
 *  subscriber's name/phone. */
function valueByAnyKey(
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    candidates: string[],
): string | null {
    for (const key of candidates) {
        const v = valueByKey(questions, answers, key,);
        if (v) return v;
    }
    return null;
}

const NAME_KEYS = ['name', 'full_name', 'fullname', 'your_name', 'first_name', 'firstname',];
const PHONE_KEYS = ['phone', 'phone_number', 'telephone', 'mobile',];

/** The submitter's email: a question of type `email`, else derived key `email`. */
function extractEmail(questions: FormQuestion[], answers: SubmittedAnswer[],): string | null {
    const emailQ = questions.find((q,) => q.type === 'email');
    if (emailQ) {
        const ans = answers.find((a,) => a.questionId === emailQ.id);
        const v = formatValue(ans?.value,).trim();
        if (v) return v;
    }
    return valueByKey(questions, answers, 'email',);
}

/** The submitter's email / name / phone as the form actions read them — shared
 *  with the reply flow so "who sent this" is decided in one place. */
export function submitterContact(
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
): { email: string | null; name: string | null; phone: string | null; } {
    return {
        email: extractEmail(questions, answers,),
        name: valueByAnyKey(questions, answers, NAME_KEYS,),
        phone: valueByAnyKey(questions, answers, PHONE_KEYS,),
    };
}

/** Render a `{{ … }}` template against a flat form-value context → string. */
/** `raw` = no HTML escaping — for a SUBJECT line (a header, not HTML). Bodies stay escaped: answers are visitor input. */
export async function renderTpl(tpl: string, context: Record<string, unknown>, opts: { raw?: boolean; } = {},): Promise<string> {
    const runtime: TemplateRuntime = {
        context,
        raw: opts.raw,
        // Form templates get the shared value functions (upper, formatDate,
        // default, …) — no entities, so anything else resolves to nothing.
        resolve: (name, args,) => {
            const v = resolveValueFunction(name, args,);
            return v === UNRESOLVED ? undefined : v;
        },
        warn: (m,) => logger.debug?.(m,),
    };
    try {
        return await renderTemplateToString(tpl, runtime,);
    } catch (e) {
        logger.warn('form email template render failed', { error: (e as Error).message, },);
        return tpl;
    }
}

async function runSubscribe(
    form: Form,
    cfg: FormActionConfig,
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    actor: FormActor,
): Promise<void> {
    if (!(await isFeatureEnabledServer('mailing_lists',))) {
        logger.warn('form subscribe action skipped: mailing_lists feature disabled', { form: form.id, },);
        return;
    }
    if (!cfg.mailingListId) {
        logger.warn('form subscribe action: no mailingListId configured', { form: form.id, },);
        return;
    }
    const email = extractEmail(questions, answers,);
    if (!email) {
        logger.warn('form subscribe action: no email field value', { form: form.id, },);
        return;
    }
    const list = await mailingListsRepo.findById(cfg.mailingListId,);
    if (!list) {
        logger.warn('form subscribe action: mailing list not found', { listId: cfg.mailingListId, },);
        return;
    }
    const name = valueByAnyKey(questions, answers, NAME_KEYS,) ?? undefined;
    const phone = valueByAnyKey(questions, answers, PHONE_KEYS,) ?? undefined;
    await mailingLists.publicSubscribe(
        list.slug,
        { email, name, phone, },
        { userId: actor.userId, userEmail: actor.userEmail, },
    );
}

/**
 * The built-in body: the form title, who sent it and when, then every answer
 * laid out like the form (sections + field widths — `formAnswersEmail.ts`).
 */
function submittedAt(timeZone: string | undefined,): string {
    const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', };
    try {
        return new Date().toLocaleString('en-US', { ...opts, timeZone, timeZoneName: 'short', } as Intl.DateTimeFormatOptions,);
    } catch {
        return new Date().toLocaleString('en-US', opts,);
    }
}

function defaultEmailBody(form: Form, questions: FormQuestion[], answers: SubmittedAnswer[], actor: FormActor, timeZone?: string,): string {
    const who = submitterContact(questions, answers,);
    const email = who.email || actor.userEmail || '';
    const from = [who.name ? escapeHtml(who.name,) : '', email ? `&lt;${escapeHtml(email,)}&gt;` : '',].filter(Boolean,).join(' ',);
    const when = submittedAt(timeZone,);
    return `<h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(form.title,)}</h1>`
        + `<p style="margin:0 0 18px;font-size:14px;color:#6b7280">New submission${from ? ` from <strong style="color:#374151">${from}</strong>` : ''} · ${escapeHtml(when,)}</p>`
        + formAnswersEmailHtml(form, questions, answers,);
}

async function runEmail(
    form: Form,
    cfg: FormActionConfig,
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    actor: FormActor = {},
): Promise<void> {
    const rawCtx = buildContext(form, questions, answers, false,);
    const htmlCtx = buildContext(form, questions, answers, true,);
    // `{{answersHtml}}` — every answer laid out like the form, for a custom body
    // (an `…Html` key, so the engine inserts it unescaped; built from escaped values).
    htmlCtx.answersHtml = formAnswersEmailHtml(form, questions, answers,);

    // "Send to" accepts a comma- (or semicolon-) separated list. Parsed with the
    // SAME shared helper the form editor validates with, so what the admin was
    // told is valid is exactly what gets mailed.
    const rendered = (await renderTpl(cfg.emailTo || '', rawCtx,)).trim();
    const { emails: recipients, invalid, } = parseEmailList(rendered,);

    if (invalid.length) {
        // Don't fail the whole action for one bad entry — mail everyone valid
        // and record the rest, since a dropped notification is otherwise silent.
        logger.warn('form email action: skipping invalid recipient(s)', {
            form: form.id,
            invalid,
        },);
    }
    if (recipients.length === 0) {
        logger.warn('form email action: no valid recipient after render', {
            form: form.id,
            to: rendered,
        },);
        return;
    }

    const subject = (await renderTpl(cfg.emailSubject || '', rawCtx, { raw: true, },)).trim()
        || `New submission: ${form.title}`;
    // Custom body → in the standard branded layout (unless it is a whole
    // document already); none → the built-in summary of every answer.
    const custom = (await renderTpl(cfg.emailBody || '', htmlCtx,)).trim();
    const layout = await brandLayout();
    const body = custom && isFullHtmlDocument(custom,)
        ? custom
        : brandedMessage(
            custom || defaultEmailBody(form, questions, answers, actor, (await getPublicSettings().catch(() => null,))?.defaults?.timezone,),
            layout,
            { title: subject, },
        );
    const text = custom ? undefined : `${form.title}\n\n${formAnswersText(form, questions, answers,)}`;

    // One message PER recipient rather than a single multi-recipient message:
    // recipients never see each other's addresses, and one rejected address
    // can't take the rest of the notifications down with it.
    const failed: string[] = [];
    for (const to of recipients) {
        try {
            await sendEmail({ to, subject, html: body, text, },);
        } catch (e) {
            failed.push(to,);
            logger.warn('form email action: send failed for recipient', {
                form: form.id,
                to,
                error: (e as Error).message,
            },);
        }
    }
    if (failed.length && failed.length === recipients.length) {
        // Every recipient failed — surface it to the caller's catch so the
        // dispatch log records the action as failed rather than succeeded.
        throw new Error(`form email action: all ${failed.length} recipient(s) failed`,);
    }
}

/**
 * Dispatch a form's configured action. Never throws — logs and returns.
 */
export async function dispatchFormAction(
    form: Form,
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
    actor: FormActor = {},
): Promise<void> {
    const action = form.action || 'submit';
    const cfg = (form.actionConfig || {}) as FormActionConfig;

    // Contact capture runs for EVERY action including plain `submit` — the
    // question "should this person be a contact?" is independent of what else
    // the form does with the submission, and gating it on subscribe/email would
    // make a save-only form unable to feed the CRM.
    if (cfg.addContact) {
        const email = extractEmail(questions, answers,);
        if (email) {
            await captureAudience({
                email,
                name: valueByAnyKey(questions, answers, NAME_KEYS,),
                phone: valueByAnyKey(questions, answers, PHONE_KEYS,),
                userId: actor.userId ?? null,
                source: `form:${form.slug}`,
            }, { addContact: true, },);
        } else {
            logger.warn('form contact capture skipped: no email field value', { form: form.id, },);
        }
    }

    if (action === 'submit') return;
    try {
        if (action === 'subscribe') {
            await runSubscribe(form, cfg, questions, answers, actor,);
        } else if (action === 'email') {
            await runEmail(form, cfg, questions, answers, actor,);
        }
    } catch (e) {
        logger.warn('form action dispatch failed', {
            action,
            form: form.id,
            error: (e as Error).message,
        },);
    }
}
