/**
 * Data access for `mail_templates`. Standard CRUD; the block payload
 * lives in `mailTemplateBlocks.repo`.
 */
import type { MailTemplate, } from '@rw/shared';
import { query, } from '../db';

interface DbRow {
    id: string;
    name: string;
    description: string | null;
    is_enabled: boolean;
    subject: string;
    preheader: string | null;
    from_name: string | null;
    from_email: string | null;
    reply_to: string | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
}

function map(row: DbRow,): MailTemplate {
    const out: MailTemplate = {
        id: row.id,
        name: row.name,
        isEnabled: row.is_enabled,
        subject: row.subject,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
    if (row.description) out.description = row.description;
    if (row.preheader) out.preheader = row.preheader;
    if (row.from_name) out.fromName = row.from_name;
    if (row.from_email) out.fromEmail = row.from_email;
    if (row.reply_to) out.replyTo = row.reply_to;
    return out;
}

export async function list(): Promise<MailTemplate[]> {
    const r = await query<DbRow>(`SELECT * FROM mail_templates ORDER BY created_at DESC`,);
    return r.rows.map(map,);
}

export async function findById(id: string,): Promise<MailTemplate | null> {
    const r = await query<DbRow>(`SELECT * FROM mail_templates WHERE id = $1`, [id,],);
    return r.rows[0] ? map(r.rows[0],) : null;
}

export interface CreateInput {
    name: string;
    description?: string;
    isEnabled?: boolean;
    subject?: string;
    preheader?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    createdBy?: string | null;
}

export async function create(input: CreateInput,): Promise<MailTemplate> {
    const r = await query<DbRow>(`
        INSERT INTO mail_templates
            (name, description, is_enabled, subject, preheader, from_name, from_email, reply_to, created_by)
        VALUES ($1, $2, COALESCE($3, TRUE), COALESCE($4, ''), $5, $6, $7, $8, $9)
        RETURNING *
    `, [
        input.name, input.description ?? null,
        input.isEnabled ?? null,
        input.subject ?? null,
        input.preheader ?? null,
        input.fromName ?? null,
        input.fromEmail ?? null,
        input.replyTo ?? null,
        input.createdBy ?? null,
    ],);
    return map(r.rows[0],);
}

export async function update(id: string, patch: Partial<CreateInput>,): Promise<MailTemplate | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown,): void => {
        values.push(val,);
        fields.push(`${col} = $${values.length}`,);
    };
    if (patch.name !== undefined) set('name', patch.name,);
    if (patch.description !== undefined) set('description', patch.description ?? null,);
    if (patch.isEnabled !== undefined) set('is_enabled', patch.isEnabled,);
    if (patch.subject !== undefined) set('subject', patch.subject,);
    if (patch.preheader !== undefined) set('preheader', patch.preheader ?? null,);
    if (patch.fromName !== undefined) set('from_name', patch.fromName ?? null,);
    if (patch.fromEmail !== undefined) set('from_email', patch.fromEmail ?? null,);
    if (patch.replyTo !== undefined) set('reply_to', patch.replyTo ?? null,);
    if (fields.length === 0) return findById(id,);
    values.push(id,);
    const r = await query<DbRow>(
        `UPDATE mail_templates SET ${fields.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function remove(id: string,): Promise<void> {
    await query(`DELETE FROM mail_templates WHERE id = $1`, [id,],);
}
