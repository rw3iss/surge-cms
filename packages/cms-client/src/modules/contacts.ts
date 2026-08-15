import type {
    ContactLinkBody, ContactLinkResponse, ContactMatchResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /contacts namespace (member-facing, feature-gated behind `contacts`). The
 * first-login "we have your info" flow: check for an unlinked CRM contact
 * matching the caller's email, then link/import it. Admin CRUD on contacts
 * goes through `cms.entities` (the `contact` entity type).
 */
export class ContactsModule extends ModuleBase {
    protected readonly module = 'contacts';

    /** GET /contacts/me — the contact linked to me (for profile prefill), or null. */
    mine(): Promise<ContactMatchResponse> {
        return this.get<ContactMatchResponse>('/contacts/me', { options: { cache: false, }, },);
    }

    /** GET /contacts/me/match — unlinked contact for my email (never cached). */
    match(): Promise<ContactMatchResponse> {
        return this.get<ContactMatchResponse>('/contacts/me/match', { options: { cache: false, }, },);
    }

    /** POST /contacts/me/link — link the matching contact to me (+ optional
     *  profile import of name/city/state). */
    link(body: ContactLinkBody,): Promise<ContactLinkResponse> {
        return this.mutate<ContactLinkResponse>('POST', '/contacts/me/link', { body, },);
    }
}
