import { beforeEach, describe, expect, it, vi, } from 'vitest';

/**
 * The recurrence → registration seam.
 *
 * Recurrence expansion, occurrence grouping and ticket pricing are each well
 * covered in isolation, but nothing joined them up: that registering for
 * occurrence *N* of a series lands on occurrence *N*'s date and not, say, the
 * series start or today. That join is exactly where a real bug hid once — the
 * repository maps `starts_at` to a `Date`, the type said `string`, and
 * `startsAt.slice(0, 10)` threw at runtime while both unit suites stayed green.
 *
 * These tests drive the REAL expander (not a hardcoded date list) and stub only
 * the database, so a change to recurrence maths is caught here as a change in
 * what gets registered.
 */

const findById = vi.fn();
const findBySlug = vi.fn();
const upsertRegistration = vi.fn();
const countRegistrations = vi.fn();

vi.mock('../../repositories/events.repo', () => ({
    findById: (...a: unknown[]) => findById(...a),
    findBySlug: (...a: unknown[]) => findBySlug(...a),
    upsertRegistration: (...a: unknown[]) => upsertRegistration(...a),
    countRegistrations: (...a: unknown[]) => countRegistrations(...a),
}),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined,), }),);
vi.mock('./settings', () => ({
    getSettings: vi.fn().mockResolvedValue({ allowRegistration: true, },),
}),);

const { register, registrantCount, defaultOccurrenceDate, } = await import('./registration');
const { expandEvent, } = await import('./occurrences');

/** A weekly series starting Tue 1 Sep 2026, 18:00Z. */
const SERIES = {
    id: 'e1',
    slug: 'weekly-standup',
    title: 'Weekly Standup',
    status: 'published',
    registrationEnabled: true,
    startsAt: '2026-09-01T18:00:00.000Z',
    endsAt: null,
    allDay: false,
    location: null,
    // The engine's own rule format ('weekly'), not iCal — see parseRecurrenceRule.
    recurrenceRule: 'weekly',
    recurrenceUntil: null,
};

/** The genuine occurrence dates, straight from the expander. */
function septemberDates(event = SERIES,): string[] {
    return expandEvent(
        event as never,
        [],
        { from: new Date('2026-09-01T00:00:00Z',), to: new Date('2026-10-01T00:00:00Z',), },
    ).map((o,) => o.occurrenceDate);
}

/**
 * `getByIdOrSlug` picks its lookup by whether the argument parses as a UUID, so
 * a test that stubs only one of the two silently exercises the other.
 */
function setEvent(event: Record<string, unknown>,): void {
    findById.mockResolvedValue(event,);
    findBySlug.mockResolvedValue(event,);
}

beforeEach(() => {
    vi.clearAllMocks();
    setEvent(SERIES,);
    countRegistrations.mockResolvedValue(0,);
    upsertRegistration.mockImplementation((row: { occurrenceDate: string; },) =>
        Promise.resolve({ id: 'r1', ...row, },));
},);

describe('registration ↔ recurrence', () => {
    it('expands the series to the five September Tuesdays', () => {
        // Guards the fixture itself: if this drifts, the tests below are lying.
        expect(septemberDates(),).toEqual([
            '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
        ],);
    },);

    it('registers against the exact occurrence asked for, not the series start', async () => {
        const third = septemberDates()[2]; // 2026-09-15
        await register({
            eventId: 'e1', occurrenceDate: third, email: 'a@example.com',
        },);

        expect(upsertRegistration,).toHaveBeenCalledWith(
            expect.objectContaining({ eventId: 'e1', occurrenceDate: '2026-09-15', },),
        );
    },);

    it('registers each occurrence of the series independently', async () => {
        for (const date of septemberDates()) {
            await register({ eventId: 'e1', occurrenceDate: date, email: 'a@example.com', },);
        }
        const stored = upsertRegistration.mock.calls.map((c,) => c[0].occurrenceDate);
        expect(stored,).toEqual(septemberDates(),);
        expect(new Set(stored,).size,).toBe(5,); // no collapsing onto one date
    },);

    it('defaults to the series START date when no occurrence is named', async () => {
        await register({ eventId: 'e1', email: 'a@example.com', },);
        expect(upsertRegistration.mock.calls[0][0].occurrenceDate,).toBe('2026-09-01',);
    },);

    it('survives a repository that returns startsAt as a Date, not a string', async () => {
        // This is what `mapRow` actually produces for a `*_at` column. The old
        // code called .slice() on it and threw at runtime.
        setEvent({ ...SERIES, startsAt: new Date(SERIES.startsAt,), },);
        await expect(register({ eventId: 'e1', email: 'a@example.com', },),).resolves.toBeTruthy();
        expect(upsertRegistration.mock.calls[0][0].occurrenceDate,).toBe('2026-09-01',);
    },);

    it('counts registrants per occurrence, not per event', async () => {
        await registrantCount('e1', '2026-09-15',);
        expect(countRegistrations,).toHaveBeenCalledWith('e1', '2026-09-15',);
    },);

    it('refuses when registration is closed on the event', async () => {
        setEvent({ ...SERIES, registrationEnabled: false, },);
        await expect(register({ eventId: 'e1', email: 'a@example.com', },),)
            .rejects.toThrow(/not open/i,);
    },);

    it('refuses an invalid email before touching the database', async () => {
        await expect(register({ eventId: 'e1', email: 'nope', },),)
            .rejects.toThrow(/valid email/i,);
        expect(upsertRegistration,).not.toHaveBeenCalled();
    },);

    it('still registers when the confirmation email fails', async () => {
        const { sendEmail, } = await import('../email');
        vi.mocked(sendEmail,).mockRejectedValueOnce(new Error('SMTP down',),);
        await expect(register({ eventId: 'e1', email: 'a@example.com', },),).resolves.toBeTruthy();
    },);
},);

describe('defaultOccurrenceDate', () => {
    it('accepts both shapes the repository can hand back', () => {
        expect(defaultOccurrenceDate('2026-09-01T18:00:00.000Z',),).toBe('2026-09-01',);
        expect(defaultOccurrenceDate(new Date('2026-09-01T18:00:00.000Z',),),).toBe('2026-09-01',);
    },);
},);
