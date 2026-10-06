/**
 * Reply SOURCES — what can be replied to. Each one loads its record by `ref`,
 * finds the recipient FROM THE STORED RECORD (never from the request), and
 * supplies the `{{ }}` objects the reply's template can use.
 *
 * Adding a source: implement `ReplySource`, add it to `SOURCES`, declare its
 * permission in `permissions/catalog.ts`, and pass its key to `<ReplyModal>`.
 *
 * Values are RAW here; `render.ts` HTML-escapes them for the email body. A
 * donor's name or a form answer is visitor-supplied, and template values are
 * interpolated unescaped — so escaping is not optional.
 */
import { deriveFieldKeys, formatAnswerValue, } from '@sitesurge/types';
import type { FormQuestion, ReplyRef, ReplySourceKey, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import * as formsRepo from '../../repositories/forms.repo';
import { mapRow, } from '../../utils/mapRow';
import { submitterContact, } from '../formActions';

export interface ReplyTarget {
    to: string;
    toName: string | null;
    title: string;
    defaultSubject: string;
    defaultMessage: string;
    /** Raw (unescaped) template objects, e.g. `{ donation, campaign }`. */
    vars: Record<string, unknown>;
    audit: { entityType: string; entityId: string; details: Record<string, unknown>; };
}

export interface ReplySource {
    key: ReplySourceKey;
    /** Checked on every target/preview/send for this source. */
    permission: string;
    /** Feature that must be on (the source's records live in its tables). */
    feature: string;
    load(ref: ReplyRef,): Promise<ReplyTarget>;
}

function need(ref: ReplyRef, key: string,): string {
    const v = ref?.[key];
    if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v,)) throw new ValidationError(`ref.${key} must be an id.`,);
    return v;
}

const greeting = (name: string | null | undefined,) =>
    name && name.trim() && name !== 'Anonymous' ? `Hi ${name.trim().split(/\s+/,)[0]},\n\n` : '';

// ─── donation ────────────────────────────────────────────────────────────
const donation: ReplySource = {
    key: 'donation',
    permission: 'campaigns.donations:reply',
    feature: 'campaigns',
    async load(ref,) {
        const campaignId = need(ref, 'campaignId',);
        const donationId = need(ref, 'donationId',);
        const res = await query(
            `SELECT d.id, d.campaign_id, d.user_id, d.donor_name, d.donor_email, d.amount_cents,
                    d.message, d.visibility, d.status, d.recurring_interval, d.created_at,
                    c.title AS campaign_title, c.slug AS campaign_slug
               FROM donations d JOIN campaigns c ON c.id = d.campaign_id
              WHERE d.id = $1 AND d.campaign_id = $2`,
            [donationId, campaignId,],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundError('Donation',);
        const d = mapRow<Record<string, unknown>>(row,);
        const email = String(d.donorEmail ?? '',).trim();
        if (!email) throw new ValidationError('This donation has no email address to reply to.',);
        const cents = Number(d.amountCents ?? 0,);
        const name = (d.donorName as string | null) ?? null;
        const campaign = { id: campaignId, title: d.campaignTitle, slug: d.campaignSlug, };
        return {
            to: email,
            toName: name,
            title: 'Reply to donor',
            defaultSubject: campaign.title ? `Thank you for supporting ${campaign.title}` : 'Thank you for your donation',
            defaultMessage: greeting(name,),
            vars: {
                donation: {
                    id: d.id,
                    name: name ?? '',
                    email,
                    amount: (cents / 100).toFixed(2,),
                    amountCents: cents,
                    message: d.message ?? '',
                    visibility: d.visibility,
                    status: d.status,
                    recurringInterval: d.recurringInterval ?? '',
                    createdAt: d.createdAt,
                },
                campaign,
            },
            audit: { entityType: 'donation', entityId: donationId, details: { campaignId, }, },
        };
    },
};

// ─── form submission ─────────────────────────────────────────────────────
const submission: ReplySource = {
    key: 'submission',
    permission: 'forms.submissions:reply',
    feature: 'forms',
    async load(ref,) {
        const formId = need(ref, 'formId',);
        const submissionId = need(ref, 'submissionId',);
        const res = await query(
            `SELECT s.id, s.user_id, s.answers, s.submitted_at, f.title AS form_title, f.slug AS form_slug,
                    u.email AS user_email
               FROM form_submissions s
               JOIN forms f ON f.id = s.form_id
               LEFT JOIN users u ON u.id = s.user_id
              WHERE s.id = $1 AND s.form_id = $2`,
            [submissionId, formId,],
        );
        const row = res.rows[0];
        if (!row) throw new NotFoundError('Submission',);
        const questions: FormQuestion[] = await formsRepo.findQuestionsByFormId(formId,);
        const answers = (Array.isArray(row.answers,) ? row.answers : []) as Array<{ questionId: string; value: unknown; }>;
        const contact = submitterContact(questions, answers,);
        // A signed-in submitter's account email stands in when the form asked for none.
        const email = (contact.email || row.user_email || '').trim();
        if (!email) throw new ValidationError('This submission has no email address to reply to.',);

        // Every answer under its field key — the same keys the form's own
        // email action uses (`Your tip` → `your_tip`), so one vocabulary.
        const keys = deriveFieldKeys(questions,);
        const fields: Record<string, string> = {};
        for (const q of questions) {
            fields[keys[q.id]] = formatAnswerValue(answers.find((a,) => a.questionId === q.id)?.value,);
        }
        const form = { id: formId, title: row.form_title, slug: row.form_slug, };
        return {
            to: email,
            toName: contact.name,
            title: 'Reply to submission',
            defaultSubject: form.title ? `Re: ${form.title}` : 'Re: your submission',
            defaultMessage: greeting(contact.name,),
            vars: {
                // Every field under its key ({{submission.your_tip}}); the fixed
                // keys below win over a field that happens to share a name.
                submission: {
                    ...fields,
                    id: row.id,
                    email,
                    name: contact.name ?? '',
                    phone: contact.phone ?? '',
                    submittedAt: row.submitted_at,
                },
                form,
            },
            audit: { entityType: 'form_submission', entityId: submissionId, details: { formId, }, },
        };
    },
};

export const SOURCES: Record<ReplySourceKey, ReplySource> = { donation, submission, };

export function getSource(key: string,): ReplySource {
    const s = (SOURCES as Record<string, ReplySource | undefined>)[key];
    if (!s) throw new NotFoundError('Reply source',);
    return s;
}
