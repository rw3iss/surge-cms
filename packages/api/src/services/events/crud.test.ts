import { describe, expect, it, vi, } from 'vitest';

/**
 * The registration-fields invariant.
 *
 * The admin UI disables the `email` checkbox, but that is a UI convention, not
 * a rule — a direct `PUT /events/:id` could drop it. The public form would then
 * collect no address while `register()` still demands one, producing a form
 * that cannot be submitted. The invariant therefore lives on the server.
 */

vi.mock('../../repositories/events.repo', () => ({}),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../email', () => ({ sendEmail: vi.fn(), }),);
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

const { normalizeRegistrationFields, } = await import('./crud');

describe('normalizeRegistrationFields', () => {
    it('adds email when a caller omits it', () => {
        expect(normalizeRegistrationFields(['name',],),).toEqual(['name', 'email',],);
    },);

    it('leaves a compliant list untouched, preserving the admin\'s order', () => {
        expect(normalizeRegistrationFields(['email', 'name', 'phone',],),)
            .toEqual(['email', 'name', 'phone',],);
    },);

    it('never produces an empty form', () => {
        expect(normalizeRegistrationFields([],),).toEqual(['email',],);
    },);

    it('drops duplicates rather than rendering the same input twice', () => {
        expect(normalizeRegistrationFields(['name', 'name', 'email',],),)
            .toEqual(['name', 'email',],);
    },);

    it('treats a differently-cased email as the email field', () => {
        // Otherwise the form would show both "Email" and "EMAIL".
        expect(normalizeRegistrationFields(['EMAIL',],),).toEqual(['EMAIL',],);
    },);

    it('discards blank entries', () => {
        expect(normalizeRegistrationFields(['name', '  ', '',],),).toEqual(['name', 'email',],);
    },);
},);
