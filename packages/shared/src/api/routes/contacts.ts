/**
 * Contacts (CRM) — request/response DTOs for the user-facing match/link
 * endpoints (`/api/v1/contacts/*`). Admin CRUD on contacts uses the generic
 * entities DTOs (the `contact` entity type); these cover only the member-facing
 * first-login match/link flow.
 */

/** A CRM contact row (the `contact` entity, camelCased). Timestamps are ISO
 *  strings over the wire. `userId` is set once the contact is linked to a user. */
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
    createdAt: string;
    updatedAt: string;
}

/** Editable contact fields (no id/userId/timestamps) — the user may amend these
 *  before confirming an import. */
export interface ContactFieldsInput {
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

/** GET /contacts/me/match — the unlinked contact matching the caller's email,
 *  or null when there's nothing to offer. */
export interface ContactMatchResponse {
    contact: Contact | null;
}

/** POST /contacts/me/link — link the matching contact to the caller.
 *  `importProfile` also copies name/city/state onto the user's profile.
 *  The contact is linked even when `importProfile` is false (dismiss still
 *  claims it, so it isn't offered again). */
export interface ContactLinkBody {
    contactId?: string;
    fields?: ContactFieldsInput;
    importProfile?: boolean;
}

/** POST /contacts/me/link — the linked contact (null when nothing matched). */
export interface ContactLinkResponse {
    contact: Contact | null;
}
