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
import { isFeatureEnabledServer, } from './settings';
import { escapeHtml, } from './ssr/blocks/_util';
import { logger, } from '../utils/logger';

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
    const q = questions.find((qq,) => keys[qq.id] === key);
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

/** Render a `{{ … }}` template against a flat form-value context → string. */
async function renderTpl(tpl: string, context: Record<string, unknown>,): Promise<string> {
    const runtime: TemplateRuntime = {
        context,
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

async function runEmail(
    form: Form,
    cfg: FormActionConfig,
    questions: FormQuestion[],
    answers: SubmittedAnswer[],
): Promise<void> {
    const rawCtx = buildContext(form, questions, answers, false,);
    const htmlCtx = buildContext(form, questions, answers, true,);

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

    const subject = (await renderTpl(cfg.emailSubject || '', rawCtx,)).trim()
        || `New submission: ${form.title}`;
    const body = (await renderTpl(cfg.emailBody || '', htmlCtx,)).trim()
        || '<p>A form was submitted.</p>';

    // One message PER recipient rather than a single multi-recipient message:
    // recipients never see each other's addresses, and one rejected address
    // can't take the rest of the notifications down with it.
    const failed: string[] = [];
    for (const to of recipients) {
        try {
            await sendEmail({ to, subject, html: body, },);
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
    if (action === 'submit') return;
    const cfg = (form.actionConfig || {}) as FormActionConfig;
    try {
        if (action === 'subscribe') {
            await runSubscribe(form, cfg, questions, answers, actor,);
        } else if (action === 'email') {
            await runEmail(form, cfg, questions, answers,);
        }
    } catch (e) {
        logger.warn('form action dispatch failed', {
            action,
            form: form.id,
            error: (e as Error).message,
        },);
    }
}
