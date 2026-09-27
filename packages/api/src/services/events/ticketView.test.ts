import { beforeEach, describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
vi.mock('../../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);
vi.mock('../../repositories/events.repo', () => ({
    findById: async () => ({
        id: 'e1',
        title: 'Gala',
        slug: 'gala',
        startsAt: '2026-10-01T19:00:00Z',
        endsAt: null,
        allDay: false,
        location: 'Hall',
        timezone: null,
        featuredImage: null,
    }),
}),);

const { getTicketView, maskEmail, } = await import('./ticketView');

const REG = {
    registration_id: 'r1',
    event_id: 'e1',
    occurrence_date: '2026-10-01',
    email: 'jane@x.co',
    name: 'Jane',
    phone: '555',
    user_id: 'u1',
    created_at: '2026-09-26T00:00:00Z',
};
const TICKETS = [
    { code: 'AAAAA-11111', status: 'valid', price_cents_paid: 0, currency: 'USD', order_id: null, tier_name: 'Free', },
    {
        code: 'BBBBB-22222',
        status: 'valid',
        price_cents_paid: 2000,
        currency: 'USD',
        order_id: 'o1',
        tier_name: 'VIP',
    },
];

beforeEach(() => {
    query.mockReset();
    query
        .mockResolvedValueOnce({ rows: [REG,], },)
        .mockResolvedValueOnce({ rows: TICKETS, },)
        .mockResolvedValueOnce({ rows: [{ id: 'o1', order_number: 'SS-1001', },], },);
},);

describe('getTicketView', () => {
    it('breaks the registration down by ticket, with the paying order', async () => {
        const v = await getTicketView('bbbbb-22222',);
        expect(v.code,).toBe('BBBBB-22222',);
        expect(v.tierName,).toBe('VIP',);
        expect(v.tickets,).toHaveLength(2,);
        expect(v.tickets[0].orderNumber,).toBeUndefined();
        expect(v.tickets[1].orderNumber,).toBe('SS-1001',);
        expect(v.totalCents,).toBe(2000,);
    });

    it('masks contact details for a stranger', async () => {
        const v = await getTicketView('AAAAA-11111',);
        expect(v.isOwner,).toBe(false,);
        expect(v.attendee.email,).toBe('j•••@x.co',);
        expect(v.attendee.phone,).toBeNull();
    });

    it('shows them to the attendee', async () => {
        const v = await getTicketView('AAAAA-11111', { id: 'u1', role: 'member', },);
        expect(v.isOwner,).toBe(true,);
        expect(v.attendee.email,).toBe('jane@x.co',);
        expect(v.attendee.phone,).toBe('555',);
    });

    it('404s an unknown code', async () => {
        query.mockReset();
        query.mockResolvedValueOnce({ rows: [], },);
        await expect(getTicketView('NOPE',),).rejects.toThrow('Ticket not found',);
    });
});

describe('maskEmail', () => {
    it('keeps the first letter and the domain', () => expect(maskEmail('bob@site.org',),).toBe('b•••@site.org',));
});
