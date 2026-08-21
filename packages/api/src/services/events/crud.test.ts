import { beforeEach, describe, expect, it, vi, } from 'vitest';

/**
 * The registration-fields invariant.
 *
 * The admin UI disables the `email` checkbox, but that is a UI convention, not
 * a rule — a direct `PUT /events/:id` could drop it. The public form would then
 * collect no address while `register()` still demands one, producing a form
 * that cannot be submitted. The invariant therefore lives on the server.
 */

const slugExists = vi.fn();
const createEvent = vi.fn();

vi.mock('../../repositories/events.repo', () => ({
    slugExists: (...a: unknown[]) => slugExists(...a),
    createEvent: (...a: unknown[]) => createEvent(...a),
}),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../email', () => ({ sendEmail: vi.fn(), }),);
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./notifications', () => ({ notifyForEvent: vi.fn(), }),);

const { create, normalizeRegistrationFields, } = await import('./crud');

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

/**
 * Slug de-duplication.
 *
 * `events.slug` is UNIQUE, so a second event with the same name is a 500 unless
 * the service suffixes it. The suffix SEQUENCE is asserted explicitly: an
 * off-by-one that starts at `-2` still "works", still passes any test that only
 * checks uniqueness, and produces URLs nobody asked for.
 */
describe('slug de-duplication on create', () => {
    const ctx = { userId: 'u1', ipAddress: null, userAgent: null, } as never;
    const input = { title: 'Summer Gala', startsAt: '2026-09-01T18:00:00.000Z', } as never;

    /** Pretend `taken` are already in the table. */
    function withTaken(...taken: string[]) {
        const set = new Set(taken,);
        slugExists.mockImplementation((s: string,) => Promise.resolve(set.has(s,),));
    }

    /** The slug the service actually tried to insert. */
    const attempted = () => createEvent.mock.calls.at(-1,)?.[0].slug;

    beforeEach(() => {
        vi.clearAllMocks();
        createEvent.mockImplementation((row: { slug: string; },) =>
            Promise.resolve({ id: 'e1', status: 'draft', ...row, },));
    },);

    it('uses the bare slug when nothing collides', async () => {
        withTaken();
        await create(input, ctx,);
        expect(attempted(),).toBe('summer-gala',);
    },);

    it('appends -1 on the FIRST collision, not -2', async () => {
        withTaken('summer-gala',);
        await create(input, ctx,);
        expect(attempted(),).toBe('summer-gala-1',);
    },);

    it('counts up one at a time across a run of collisions', async () => {
        withTaken('summer-gala', 'summer-gala-1', 'summer-gala-2',);
        await create(input, ctx,);
        expect(attempted(),).toBe('summer-gala-3',);
    },);

    it('fills a GAP rather than always taking the highest suffix', async () => {
        // -1 was deleted; the next event should reuse it.
        withTaken('summer-gala', 'summer-gala-2',);
        await create(input, ctx,);
        expect(attempted(),).toBe('summer-gala-1',);
    },);

    it('de-duplicates an explicitly supplied slug too', async () => {
        withTaken('my-choice',);
        await create({ ...(input as object), slug: 'my-choice', } as never, ctx,);
        expect(attempted(),).toBe('my-choice-1',);
    },);

    it('retries with the next suffix when it loses a race to the UNIQUE index', async () => {
        withTaken('summer-gala',);
        // First insert loses the race; on the retry the winner is now visible.
        createEvent.mockImplementationOnce(() => {
            slugExists.mockImplementation((s: string,) =>
                Promise.resolve(['summer-gala', 'summer-gala-1',].includes(s,),));
            return Promise.reject(Object.assign(new Error('duplicate key',), { code: '23505', },),);
        },);
        const saved = await create(input, ctx,);
        expect(attempted(),).toBe('summer-gala-2',);
        expect(saved,).toBeTruthy();
    },);

    it('does not swallow an unrelated database error', async () => {
        withTaken();
        createEvent.mockRejectedValue(Object.assign(new Error('boom',), { code: '42P01', },),);
        await expect(create(input, ctx,),).rejects.toThrow(/boom/,);
        expect(createEvent,).toHaveBeenCalledTimes(1,); // not retried
    },);
},);
