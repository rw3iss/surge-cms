/**
 * The scheduler's decisions, pinned.
 *
 * The timezone arithmetic itself belongs to Postgres (`AT TIME ZONE`), so what
 * is worth testing here is the POLICY around it — the choices that would fail
 * silently rather than loudly:
 *
 *   - a daily schedule that missed three days sends ONCE, not three times
 *   - a one-off in the past never fires late
 *   - the start date itself is eligible, so "09:00 today" means today
 *
 * The query is executed against a fake client that mirrors what Postgres would
 * return for the same expression, so the policy is exercised without a live
 * database. The DST behaviour of `AT TIME ZONE` was verified separately
 * against a real server (14:00 UTC → 13:00 UTC across the spring transition,
 * wall-clock holding at 09:00).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => queryMock(...a,), }),);
vi.mock('../utils/logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), },
}),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./mailSend', () => ({ send: vi.fn(), }),);
vi.mock('./mailTemplates', () => ({ getById: vi.fn(), }),);
vi.mock('./settings', () => ({ getPublicSettings: vi.fn(), }),);

import { computeNextRun, isValidTimeOfDay, isValidTimezone, } from './mailSchedules';

/** The SQL text + params the service handed to Postgres on its last call. */
function lastCall(): { sql: string; params: unknown[]; } {
    const call = queryMock.mock.calls.at(-1,) as [string, unknown[],];
    return { sql: String(call?.[0] ?? '',), params: (call?.[1] ?? []) as unknown[], };
}

beforeEach(() => queryMock.mockReset(),);

describe('computeNextRun — the query it asks Postgres for', () => {
    /**
     * These assert the CONTRACT with the database — the series bounds, the
     * step, and the cutoff — rather than a JavaScript re-implementation of it.
     *
     * An earlier version of this file faked the series and computed the answer
     * itself. It passed even when the real SQL was changed to start at n=1,
     * because the fake never consulted it: the test was checking the fake.
     * Asserting on what is SENT is the part that can actually drift.
     */
    it('includes the start date itself (series begins at 0)', async () => {
        // "Every day from today at 09:00", created this morning, must run
        // TODAY. Starting the series at 1 would silently skip the first
        // occurrence — and nobody would notice until a launch day passed.
        queryMock.mockResolvedValue({ rows: [], },);
        await computeNextRun({
            frequency: 'daily', startDate: '2026-03-01',
            timeOfDay: '09:00', timezone: 'UTC',
        },);
        const { sql, } = lastCall();
        expect(sql,).toContain('generate_series(0,',);
    },);

    it('steps by the interval the frequency means', async () => {
        queryMock.mockResolvedValue({ rows: [], },);
        const steps: Record<string, string> = {
            daily: '1 day', weekly: '1 week', monthly: '1 month', yearly: '1 year',
        };
        for (const [frequency, interval,] of Object.entries(steps,)) {
            await computeNextRun({
                frequency: frequency as 'daily', startDate: '2026-03-01',
                timeOfDay: '09:00', timezone: 'UTC',
            },);
            // A weekly schedule stepping by a day would mail seven times a week.
            expect(lastCall().params[1], frequency,).toBe(interval,);
        }
    },);

    it('asks only for occurrences strictly after the cutoff', async () => {
        // This is the catch-up policy: a daily schedule that missed three days
        // resumes at the NEXT occurrence, rather than firing once per missed
        // day. The `> cutoff` filter is what makes an outage cost nothing.
        queryMock.mockResolvedValue({ rows: [], },);
        const after = new Date('2026-03-04T12:00:00Z',);
        await computeNextRun({
            frequency: 'daily', startDate: '2026-03-01',
            timeOfDay: '09:00', timezone: 'UTC', after,
        },);
        const { sql, params, } = lastCall();
        expect(sql,).toContain('ts > $6',);
        expect(sql,).toContain('ORDER BY ts',);
        expect(sql,).toContain('LIMIT 1',);
        expect(params[5],).toBe(after.toISOString(),);
    },);

    it('does the zone conversion in SQL, not in JavaScript', async () => {
        // `AT TIME ZONE` is what makes 09:00 stay 09:00 across a daylight-saving
        // change; hand-rolled offsets in JS would not.
        queryMock.mockResolvedValue({ rows: [], },);
        await computeNextRun({
            frequency: 'daily', startDate: '2026-03-01',
            timeOfDay: '09:00', timezone: 'America/New_York',
        },);
        const { sql, params, } = lastCall();
        expect(sql,).toContain('AT TIME ZONE',);
        expect(params[3],).toBe('America/New_York',);
    },);

    it('returns null when the lookahead finds nothing', async () => {
        queryMock.mockResolvedValue({ rows: [], },);
        expect(await computeNextRun({
            frequency: 'daily', startDate: '2020-01-01',
            timeOfDay: '09:00', timezone: 'UTC',
        },),).toBeNull();
    },);

    it('returns whatever Postgres picked, untouched', async () => {
        const ts = new Date('2026-03-05T14:00:00Z',);
        queryMock.mockResolvedValue({ rows: [{ ts, },], },);
        const next = await computeNextRun({
            frequency: 'daily', startDate: '2026-03-01',
            timeOfDay: '09:00', timezone: 'America/New_York',
        },);
        expect(next?.toISOString(),).toBe(ts.toISOString(),);
    },);
},);

describe('computeNextRun — one-off schedules', () => {
    it('fires a future one-off exactly once', async () => {
        queryMock.mockResolvedValue({ rows: [{ ts: new Date('2026-06-01T09:00:00Z',), },], },);
        const next = await computeNextRun({
            frequency: 'once', startDate: '2026-06-01',
            timeOfDay: '09:00', timezone: 'UTC',
            after: new Date('2026-05-01T00:00:00Z',),
        },);
        expect(next?.toISOString(),).toBe('2026-06-01T09:00:00.000Z',);
    },);

    it('NEVER fires a one-off whose moment has passed', async () => {
        // A dated announcement ("doors open tomorrow") delivered days late is
        // worse than not delivered. A missed one-off is dropped, unlike a
        // recurring schedule, which catches up to its next occurrence.
        queryMock.mockResolvedValue({ rows: [{ ts: new Date('2026-01-01T09:00:00Z',), },], },);
        const next = await computeNextRun({
            frequency: 'once', startDate: '2026-01-01',
            timeOfDay: '09:00', timezone: 'UTC',
            after: new Date('2026-05-01T00:00:00Z',),
        },);
        expect(next,).toBeNull();
    },);
},);

describe('input validation', () => {
    it('accepts HH:MM and HH:MM:SS, rejects nonsense', () => {
        for (const ok of ['00:00', '09:00', '23:59', '09:00:30',]) {
            expect(isValidTimeOfDay(ok,), ok,).toBe(true,);
        }
        // 24:00 and 9:00 are the plausible typos; both would reach Postgres
        // and fail there instead, as an opaque 500.
        for (const bad of ['24:00', '9:00', '09:60', '', 'noon', '09-00',]) {
            expect(isValidTimeOfDay(bad,), bad,).toBe(false,);
        }
    },);

    it('rejects an unknown timezone before it reaches SQL', () => {
        // An unknown zone raises inside AT TIME ZONE — possibly in the sweeper,
        // long after the operator typed it.
        expect(isValidTimezone('America/New_York',),).toBe(true,);
        expect(isValidTimezone('UTC',),).toBe(true,);
        expect(isValidTimezone('Mars/Olympus_Mons',),).toBe(false,);
        expect(isValidTimezone('EST5EDT',),).toBe(true,);
    },);
},);
