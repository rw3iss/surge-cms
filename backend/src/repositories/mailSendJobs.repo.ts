/**
 * Send-job storage. One row per "operator clicks Send". Holds the
 * snapshot of subject/preheader/from + the rendered HTML template
 * (with `{{...}}` tokens still in it). The worker reads recipients
 * off mail_send_recipients and substitutes per-recipient vars at
 * delivery.
 */
import type { MailSendJob, MailSendJobStatus, } from '@rw/shared';
import { query, } from '../db';

interface DbRow {
    id: string;
    list_id: string;
    template_id: string | null;
    subject: string;
    preheader: string | null;
    from_name: string | null;
    from_email: string | null;
    reply_to: string | null;
    rendered_html_template: string;
    status: MailSendJobStatus;
    total_recipients: number;
    sent_count: number;
    failed_count: number;
    started_at: Date | null;
    completed_at: Date | null;
    error: string | null;
    created_by: string | null;
    created_at: Date;
}

function map(row: DbRow,): MailSendJob {
    const out: MailSendJob = {
        id: row.id,
        listId: row.list_id,
        templateId: row.template_id,
        subject: row.subject,
        renderedHtmlTemplate: row.rendered_html_template,
        status: row.status,
        totalRecipients: row.total_recipients,
        sentCount: row.sent_count,
        failedCount: row.failed_count,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
    };
    if (row.preheader) out.preheader = row.preheader;
    if (row.from_name) out.fromName = row.from_name;
    if (row.from_email) out.fromEmail = row.from_email;
    if (row.reply_to) out.replyTo = row.reply_to;
    if (row.started_at) out.startedAt = row.started_at.toISOString();
    if (row.completed_at) out.completedAt = row.completed_at.toISOString();
    if (row.error) out.error = row.error;
    return out;
}

export interface CreateInput {
    listId: string;
    templateId?: string | null;
    subject: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    renderedHtmlTemplate: string;
    totalRecipients: number;
    createdBy?: string | null;
}

export async function create(input: CreateInput,): Promise<MailSendJob> {
    const r = await query<DbRow>(`
        INSERT INTO mail_send_jobs
            (list_id, template_id, subject, preheader, from_name, from_email, reply_to,
             rendered_html_template, total_recipients, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `, [
        input.listId, input.templateId ?? null,
        input.subject, input.preheader ?? null,
        input.fromName ?? null, input.fromEmail ?? null, input.replyTo ?? null,
        input.renderedHtmlTemplate, input.totalRecipients,
        input.createdBy ?? null,
    ],);
    return map(r.rows[0],);
}

export async function findById(id: string,): Promise<MailSendJob | null> {
    const r = await query<DbRow>(`SELECT * FROM mail_send_jobs WHERE id = $1`, [id,],);
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function findRunning(): Promise<MailSendJob[]> {
    const r = await query<DbRow>(`SELECT * FROM mail_send_jobs WHERE status = 'running'`,);
    return r.rows.map(map,);
}

export async function listForList(listId: string, limit = 20,): Promise<MailSendJob[]> {
    const r = await query<DbRow>(
        `SELECT * FROM mail_send_jobs WHERE list_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [listId, limit,],
    );
    return r.rows.map(map,);
}

export interface StatusPatch {
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export async function setStatus(id: string, status: MailSendJobStatus, patch: StatusPatch = {},): Promise<void> {
    const fields: string[] = ['status = $1',];
    const values: unknown[] = [status,];
    if (patch.startedAt !== undefined) { values.push(patch.startedAt,); fields.push(`started_at = $${values.length}`,); }
    if (patch.completedAt !== undefined) { values.push(patch.completedAt,); fields.push(`completed_at = $${values.length}`,); }
    if (patch.error !== undefined) { values.push(patch.error,); fields.push(`error = $${values.length}`,); }
    values.push(id,);
    await query(`UPDATE mail_send_jobs SET ${fields.join(', ',)} WHERE id = $${values.length}`, values,);
}

export async function incrementCounts(id: string, sent: number, failed: number,): Promise<void> {
    if (sent === 0 && failed === 0) return;
    await query(
        `UPDATE mail_send_jobs SET sent_count = sent_count + $1, failed_count = failed_count + $2 WHERE id = $3`,
        [sent, failed, id,],
    );
}
