/**
 * A free ticket order registers its buyer as an attendee. The buyer is asked
 * the event's registration questions on the same form, so those answers
 * (organization, notes) must reach the registration, not be dropped.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const register = vi.fn(async (input: Record<string, unknown>,) => ({ id: 'reg-1', ...input, }));
vi.mock('./registration', () => ({ register, }),);
vi.mock('./settings', () => ({ getSettings: async () => ({ allowTicketing: true, allowRegistration: true, }), }),);
vi.mock('./tickets', () => ({
    resolveTicketLines: async (lines: Array<Record<string, unknown>>,) => ({
        lines: lines.map(l => ({ ...l, currency: 'USD', priceCents: 0, tierName: 'General', })),
        totalCents: 0,
    }),
    issueTickets: async () => [{ code: 'ABC123', tierName: 'General', },],
}),);
vi.mock('../email', () => ({ sendEmail: vi.fn(async () => undefined), }),);
vi.mock('../../repositories/events.repo', () => ({ getById: vi.fn(async () => null), }),);

const { purchaseTickets, } = await import('./purchase');

const LINE = {
    eventId: '00000000-0000-0000-0000-000000000001',
    occurrenceDate: '2026-10-01',
    tierId: '00000000-0000-0000-0000-000000000002',
    quantity: 1,
};

beforeEach(() => register.mockClear());

describe('purchaseTickets — attendee details', () => {
    it('forwards the extra registration answers to the registration', async () => {
        await purchaseTickets({
            lines: [LINE,] as never,
            email: 'a@b.test',
            name: 'Ann',
            fields: { organization: 'Acme', notes: 'Aisle seat', },
            userId: 'user-1',
        },);
        expect(register,).toHaveBeenCalledTimes(1,);
        expect(register.mock.calls[0][0],).toMatchObject({
            email: 'a@b.test',
            name: 'Ann',
            fields: { organization: 'Acme', notes: 'Aisle seat', },
            userId: 'user-1',
        },);
    });

    it('still works with no extra answers', async () => {
        const res = await purchaseTickets({ lines: [LINE,] as never, email: 'a@b.test', },);
        expect(res.status,).toBe('confirmed',);
        expect(register.mock.calls[0][0].fields,).toBeUndefined();
    });
});
