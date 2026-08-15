/**
 * Contacts (CRM) — user-facing endpoints (feature-gated behind `contacts`).
 * Admin CRUD on contacts is served by the generic entities module
 * (`/api/v1/entities/contact`); these two routes are the member-facing
 * match/link operations the generic staff-only routes can't do:
 *   GET  /contacts/me/match  — is there an unlinked contact for my email?
 *   POST /contacts/me/link   — link it to me (+ optionally import to my profile)
 */
import { z, } from 'zod';
import { defineRoute, } from '../api/defineRoute';
import { UnauthorizedError, } from '../core/errors';
import * as contactsService from '../services/contacts';

const nstr = z.string().trim().max(255,).nullish();

const contactFieldsSchema = z.object({
    firstName: nstr,
    lastName: nstr,
    email: nstr,
    mobilePhone: nstr,
    primaryPhone: nstr,
    streetAddress1: nstr,
    streetAddress2: nstr,
    city: nstr,
    zip: nstr,
    state: nstr,
    country: nstr,
    timeZone: nstr,
}).partial();

const linkSchema = z.object({
    contactId: z.string().optional(),
    fields: contactFieldsSchema.optional(),
    importProfile: z.boolean().optional(),
});

export const contactsRoutes = [
    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'The CRM contact linked to the current user (for profile prefill), or null',
        handler: async ({ user, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            const contact = await contactsService.getLinkedForUser(user.id,);
            return { contact, };
        },
    },),
    defineRoute({
        method: 'get', path: '/me/match', auth: 'user',
        summary: 'Find an unlinked CRM contact matching the current user\'s email',
        handler: async ({ user, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            const contact = await contactsService.matchByEmail(user.email,);
            return { contact, };
        },
    },),
    defineRoute({
        method: 'post', path: '/me/link', auth: 'user',
        summary: 'Link a matching CRM contact to the current user (+ optional profile import)',
        input: { body: linkSchema, },
        handler: async ({ user, body, audit, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            const contact = await contactsService.linkAndImport(
                { id: user.id, email: user.email, },
                { contactId: body.contactId, fields: body.fields, importProfile: body.importProfile, },
                audit(),
            );
            return { contact, };
        },
    },),
];
