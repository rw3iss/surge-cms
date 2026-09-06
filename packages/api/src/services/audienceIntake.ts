/**
 * One place where a person's details enter the CMS's audience systems.
 *
 * Registration, the shop's new-merchandise signup and form submissions all end
 * with the same question: "should this person become a Contact, and should they
 * join a mailing list?" Answering it three times produced three slightly
 * different dedupe rules, which is how you end up with the same address stored
 * twice with different capitalisation.
 *
 * So every path calls `captureAudience`, and the rules live here:
 *
 *  - **Contacts are deduped on lowercased email**, across linked AND unlinked
 *    rows. `contacts.matchByEmail` deliberately only sees UNLINKED contacts
 *    (that's what makes the first-login link prompt one-time) — reusing it here
 *    would have created a second contact for anyone already linked to a user.
 *  - **A blank field never overwrites a stored one.** A shop signup that
 *    collects only an email must not wipe the phone number a CRM import
 *    supplied.
 *  - **Everything is best-effort.** These run at the end of registration and
 *    checkout; a CRM write failing must not fail the thing the person actually
 *    came to do. Failures are logged and reported in the result.
 */
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { isFeatureEnabledServer, } from './settings';
import * as mailingLists from './mailingLists';

export interface AudienceIntakeInput {
    email: string;
    name?: string | null;
    /** Free-text phone; stored on both the contact and the subscriber. */
    phone?: string | null;
    /** Link the contact to this user when one is created/found unlinked. */
    userId?: string | null;
    /** For logs — which flow captured this person. */
    source: string;
}

export interface AudienceIntakeOptions {
    /** Create/update a Contact. Ignored when the contacts feature is off. */
    addContact?: boolean;
    /** Subscribe to this list. Ignored when blank or the feature is off. */
    mailingListId?: string | null;
}

export interface AudienceIntakeResult {
    contactId: string | null;
    contactCreated: boolean;
    subscribed: boolean;
    subscriptionCreated: boolean;
    errors: string[];
}

/** Split a display name into first/last for the contact columns. */
function splitName(name: string,): { first: string; last: string; } {
    const parts = name.trim().split(/\s+/,).filter(Boolean,);
    if (parts.length === 0) return { first: '', last: '', };
    if (parts.length === 1) return { first: parts[0], last: '', };
    return { first: parts.slice(0, -1,).join(' ',), last: parts.at(-1,) ?? '', };
}

/**
 * Find a contact by email regardless of whether it's linked to a user.
 *
 * Deliberately NOT `contacts.matchByEmail`, which filters to unlinked rows.
 */
async function findContactByEmail(email: string,): Promise<{ id: string; user_id: string | null; } | null> {
    const r = await query<{ id: string; user_id: string | null; }>(
        `SELECT id, user_id FROM ce_contact WHERE LOWER(email) = LOWER($1) ORDER BY created_at ASC LIMIT 1`,
        [email,],
    );
    return r.rows[0] ?? null;
}

/**
 * Create or update the contact for this person.
 *
 * `COALESCE(NULLIF(excluded, ''), existing)` on every optional column is what
 * enforces "a blank never overwrites".
 */
async function upsertContact(input: AudienceIntakeInput,): Promise<{ id: string; created: boolean; }> {
    const email = input.email.trim();
    const { first, last, } = splitName(input.name ?? '',);
    const phone = (input.phone ?? '').trim();

    const existing = await findContactByEmail(email,);
    if (existing) {
        await query(
            `UPDATE ce_contact
                SET first_name = COALESCE(NULLIF($2, ''), first_name),
                    last_name  = COALESCE(NULLIF($3, ''), last_name),
                    mobile_phone = COALESCE(NULLIF($4, ''), mobile_phone),
                    user_id    = COALESCE(user_id, $5),
                    updated_at = NOW()
              WHERE id = $1`,
            [existing.id, first, last, phone, input.userId ?? null,],
        );
        return { id: existing.id, created: false, };
    }

    const r = await query<{ id: string; }>(
        `INSERT INTO ce_contact (email, first_name, last_name, mobile_phone, user_id)
              VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), $5)
         RETURNING id`,
        [email, first, last, phone, input.userId ?? null,],
    );
    return { id: r.rows[0].id, created: true, };
}

/**
 * Put a person into the audience systems the caller asked for.
 *
 * Never throws. Each side is independent: a failed CRM write still leaves the
 * mailing-list subscription in place, and vice versa.
 */
export async function captureAudience(
    input: AudienceIntakeInput,
    opts: AudienceIntakeOptions,
): Promise<AudienceIntakeResult> {
    const result: AudienceIntakeResult = {
        contactId: null, contactCreated: false,
        subscribed: false, subscriptionCreated: false,
        errors: [],
    };

    const email = input.email?.trim();
    if (!email) {
        result.errors.push('no email',);
        return result;
    }

    if (opts.addContact) {
        try {
            // Checked here rather than by the caller so no path can bypass the
            // feature gate and write to a table that may not exist.
            if (await isFeatureEnabledServer('contacts',)) {
                const c = await upsertContact({ ...input, email, },);
                result.contactId = c.id;
                result.contactCreated = c.created;
            }
        } catch (err) {
            logger.error('captureAudience: contact upsert failed', { source: input.source, error: err, },);
            result.errors.push('contact',);
        }
    }

    if (opts.mailingListId) {
        try {
            if (await isFeatureEnabledServer('mailing_lists',)) {
                const { created, } = await mailingLists.addSubscriber(opts.mailingListId, {
                    email,
                    name: input.name ?? undefined,
                    phone: input.phone ?? undefined,
                },);
                result.subscribed = true;
                result.subscriptionCreated = created;
            }
        } catch (err) {
            logger.error('captureAudience: subscribe failed', {
                source: input.source, listId: opts.mailingListId, error: err,
            },);
            result.errors.push('subscribe',);
        }
    }

    logger.info('captureAudience', { source: input.source, ...result, },);
    return result;
}
