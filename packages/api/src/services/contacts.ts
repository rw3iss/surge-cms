/**
 * Contacts (CRM) service — the small, purpose-built surface the auth/profile
 * flows use to match, link, and upsert `ce_contact` rows against registered
 * users. Admin CRUD on contacts goes through the generic entities service; this
 * module handles only the user-facing operations that the generic (staff-only)
 * routes can't:
 *   - matchForUser        — find an UNLINKED contact by the user's email
 *   - linkAndImport       — link a contact to a user (+ optionally copy its
 *                           name/city/state onto the user's profile)
 *   - upsertForUser       — on profile save, ensure the user's linked contact
 *                           exists and mirror the saved fields onto it
 *
 * All operations run direct SQL against `ce_contact` (the columns are fixed by
 * migration 090); the table is owned/managed by the Contacts feature + the
 * `contact` entity type.
 */
import { query, } from '../db';
import { mapRow, } from '../utils/mapRow';
import * as usersService from './users';
import type { AuditContext, } from './types';

/** Camel-cased `ce_contact` row (userId/firstName/…/timeZone + timestamps). */
export interface Contact {
    id: string;
    userId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    mobilePhone: string | null;
    primaryPhone: string | null;
    streetAddress1: string | null;
    streetAddress2: string | null;
    city: string | null;
    zip: string | null;
    state: string | null;
    country: string | null;
    timeZone: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/** Contact fields a user may edit/import (no id/userId/timestamps). */
export interface ContactFields {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    mobilePhone?: string | null;
    primaryPhone?: string | null;
    streetAddress1?: string | null;
    streetAddress2?: string | null;
    city?: string | null;
    zip?: string | null;
    state?: string | null;
    country?: string | null;
    timeZone?: string | null;
}

/** camelCase field key → ce_contact column. */
const FIELD_COLUMN: Record<keyof ContactFields, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    email: 'email',
    mobilePhone: 'mobile_phone',
    primaryPhone: 'primary_phone',
    streetAddress1: 'street_address1',
    streetAddress2: 'street_address2',
    city: 'city',
    zip: 'zip',
    state: 'state',
    country: 'country',
    timeZone: 'time_zone',
};

const SELECT = `id, user_id, first_name, last_name, email, mobile_phone, primary_phone,
    street_address1, street_address2, city, zip, state, country, time_zone,
    created_at, updated_at`;

function clean(v: string | null | undefined,): string | null {
    if (v == null) return null;
    const t = String(v,).trim();
    return t === '' ? null : t;
}

/** The subset of provided ContactFields as {column: value}, trimmed. Absent
 *  keys are omitted (so a partial upsert only touches provided fields). */
function toColumns(fields: ContactFields,): { cols: string[]; values: unknown[]; } {
    const cols: string[] = [];
    const values: unknown[] = [];
    for (const [key, col,] of Object.entries(FIELD_COLUMN,) as [keyof ContactFields, string][]) {
        if (fields[key] !== undefined) {
            cols.push(col,);
            values.push(clean(fields[key],),);
        }
    }
    return { cols, values, };
}

/** Find an UNLINKED contact matching this email (case-insensitive). The
 *  "unlinked" filter is what makes the first-login prompt one-time: once a
 *  contact is linked to a user it stops matching. */
export async function matchByEmail(email: string,): Promise<Contact | null> {
    const e = clean(email,);
    if (!e) return null;
    const r = await query(
        `SELECT ${SELECT} FROM ce_contact
         WHERE user_id IS NULL AND LOWER(email) = LOWER($1)
         ORDER BY created_at ASC LIMIT 1`,
        [e,],
    );
    return r.rows[0] ? mapRow<Contact>(r.rows[0],) : null;
}

/** The contact already linked to this user, if any. */
export async function getLinkedForUser(userId: string,): Promise<Contact | null> {
    const r = await query(
        `SELECT ${SELECT} FROM ce_contact WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [userId,],
    );
    return r.rows[0] ? mapRow<Contact>(r.rows[0],) : null;
}

async function getById(id: string,): Promise<Contact | null> {
    const r = await query(`SELECT ${SELECT} FROM ce_contact WHERE id = $1`, [id,],);
    return r.rows[0] ? mapRow<Contact>(r.rows[0],) : null;
}

/**
 * Link the matching contact to this user. Optionally applies the user's edits
 * to the contact first, and (when `importProfile`) copies name/city/state onto
 * the user's base profile. Returns the linked contact, or null when there is no
 * unlinked contact for the email (nothing to link).
 *
 * The link happens even when `importProfile` is false — per spec, dismissing the
 * prompt still claims the contact so it won't be offered again.
 */
export async function linkAndImport(
    user: { id: string; email: string; },
    opts: { fields?: ContactFields; importProfile?: boolean; contactId?: string; },
    ctx: AuditContext,
): Promise<Contact | null> {
    // Resolve the target: an explicit id (must still be unlinked) or the email match.
    let target = opts.contactId ? await getById(opts.contactId,) : await matchByEmail(user.email,);
    if (!target || (target.userId && target.userId !== user.id)) {
        // Fall back to the email match if the given id is already linked elsewhere.
        target = await matchByEmail(user.email,);
    }
    if (!target) return null;

    // Apply edits + link in one UPDATE.
    const { cols, values, } = toColumns(opts.fields ?? {},);
    const setParts = cols.map((c, i,) => `${c} = $${i + 1}`,);
    setParts.push(`user_id = $${cols.length + 1}`,);
    const params = [...values, user.id, target.id,];
    const r = await query(
        `UPDATE ce_contact SET ${setParts.join(', ',)}, updated_at = NOW()
         WHERE id = $${cols.length + 2}
         RETURNING ${SELECT}`,
        params,
    );
    const linked = mapRow<Contact>(r.rows[0],);

    if (opts.importProfile) {
        const f = opts.fields ?? linked;
        const profilePatch: Record<string, unknown> = {};
        if (f.firstName !== undefined) profilePatch.firstName = clean(f.firstName,);
        if (f.lastName !== undefined) profilePatch.lastName = clean(f.lastName,);
        if (f.city !== undefined) profilePatch.locationCity = clean(f.city,);
        if (f.state !== undefined) profilePatch.locationState = clean(f.state,);
        if (Object.keys(profilePatch,).length > 0) {
            await usersService.update(user.id, profilePatch, ctx,);
        }
    }
    return linked;
}

/**
 * On profile save: ensure the user has a linked contact and mirror the given
 * fields onto it. Finds the user's linked contact; else an unlinked email match
 * (and links it); else inserts a new contact (user_id set). Idempotent.
 */
export async function upsertForUser(
    user: { id: string; email: string; },
    fields: ContactFields,
    createdBy?: string,
): Promise<Contact> {
    const existing = (await getLinkedForUser(user.id,)) ?? (await matchByEmail(user.email,));

    // Always keep the contact's email aligned with the user's account email.
    const merged: ContactFields = { email: user.email, ...fields, };

    if (existing) {
        const { cols, values, } = toColumns(merged,);
        const setParts = cols.map((c, i,) => `${c} = $${i + 1}`,);
        setParts.push(`user_id = $${cols.length + 1}`,);
        const params = [...values, user.id, existing.id,];
        const r = await query(
            `UPDATE ce_contact SET ${setParts.join(', ',)}, updated_at = NOW()
             WHERE id = $${cols.length + 2}
             RETURNING ${SELECT}`,
            params,
        );
        return mapRow<Contact>(r.rows[0],);
    }

    const { cols, values, } = toColumns(merged,);
    const allCols = ['user_id', ...cols, 'created_by',];
    const allVals = [user.id, ...values, createdBy ?? user.id,];
    const placeholders = allVals.map((_, i,) => `$${i + 1}`,);
    const r = await query(
        `INSERT INTO ce_contact (${allCols.join(', ',)})
         VALUES (${placeholders.join(', ',)})
         RETURNING ${SELECT}`,
        allVals,
    );
    return mapRow<Contact>(r.rows[0],);
}
