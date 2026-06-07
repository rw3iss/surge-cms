/**
 * Data access for `mailing_lists`. Standard CRUD with denormalized
 * `subscriberCount` on list-reads (subquery against
 * `mailing_list_subscribers`, scoped to `status='subscribed'`).
 */
import type { MailingList, } from '@rw/cms-shared';
import { query, } from '../db';

interface DbRow {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    is_enabled: boolean;
    registered_users_only: boolean;
    double_opt_in: boolean;
    default_template_id: string | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    subscriber_count?: number;
}

function map(row: DbRow,): MailingList {
    const out: MailingList = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        isEnabled: row.is_enabled,
        registeredUsersOnly: row.registered_users_only,
        doubleOptIn: row.double_opt_in,
        defaultTemplateId: row.default_template_id,
        createdBy: row.created_by,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
    if (row.description !== null) out.description = row.description;
    if (typeof row.subscriber_count === 'number') out.subscriberCount = row.subscriber_count;
    return out;
}

export async function list(): Promise<MailingList[]> {
    const r = await query<DbRow>(`
        SELECT l.*,
               (SELECT COUNT(*)::int FROM mailing_list_subscribers s
                WHERE s.list_id = l.id AND s.status = 'subscribed') AS subscriber_count
        FROM mailing_lists l
        ORDER BY l.created_at DESC
    `,);
    return r.rows.map(map,);
}

export async function findById(id: string,): Promise<MailingList | null> {
    const r = await query<DbRow>(`
        SELECT l.*,
               (SELECT COUNT(*)::int FROM mailing_list_subscribers s
                WHERE s.list_id = l.id AND s.status = 'subscribed') AS subscriber_count
        FROM mailing_lists l WHERE l.id = $1
    `, [id,],);
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function findBySlug(slug: string,): Promise<MailingList | null> {
    const r = await query<DbRow>(`SELECT * FROM mailing_lists WHERE slug = $1`, [slug,],);
    return r.rows[0] ? map(r.rows[0],) : null;
}

export interface CreateInput {
    slug: string;
    name: string;
    description?: string;
    isEnabled?: boolean;
    registeredUsersOnly?: boolean;
    doubleOptIn?: boolean;
    defaultTemplateId?: string | null;
    createdBy?: string | null;
}

export async function create(input: CreateInput,): Promise<MailingList> {
    const r = await query<DbRow>(`
        INSERT INTO mailing_lists
            (slug, name, description, is_enabled, registered_users_only, double_opt_in, default_template_id, created_by)
        VALUES ($1, $2, $3, COALESCE($4, TRUE), COALESCE($5, FALSE), COALESCE($6, FALSE), $7, $8)
        RETURNING *
    `, [
        input.slug,
        input.name,
        input.description ?? null,
        input.isEnabled ?? null,
        input.registeredUsersOnly ?? null,
        input.doubleOptIn ?? null,
        input.defaultTemplateId ?? null,
        input.createdBy ?? null,
    ],);
    return map(r.rows[0],);
}

export async function update(id: string, patch: Partial<CreateInput>,): Promise<MailingList | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown,): void => {
        values.push(val,);
        fields.push(`${col} = $${values.length}`,);
    };
    if (patch.slug !== undefined) set('slug', patch.slug,);
    if (patch.name !== undefined) set('name', patch.name,);
    if (patch.description !== undefined) set('description', patch.description ?? null,);
    if (patch.isEnabled !== undefined) set('is_enabled', patch.isEnabled,);
    if (patch.registeredUsersOnly !== undefined) set('registered_users_only', patch.registeredUsersOnly,);
    if (patch.doubleOptIn !== undefined) set('double_opt_in', patch.doubleOptIn,);
    if (patch.defaultTemplateId !== undefined) set('default_template_id', patch.defaultTemplateId,);
    if (fields.length === 0) return findById(id,);
    values.push(id,);
    const r = await query<DbRow>(
        `UPDATE mailing_lists SET ${fields.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    return r.rows[0] ? map(r.rows[0],) : null;
}

export async function remove(id: string,): Promise<void> {
    await query(`DELETE FROM mailing_lists WHERE id = $1`, [id,],);
}
