/**
 * Paid event tickets from a shop order are issued once payment succeeds:
 * one registration per (event, date), at the price the buyer paid.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), }, }),);
const register = vi.fn(async (input: Record<string, unknown>,) => ({ id: 'reg-1', ...input, }));
vi.mock('../events/registration', () => ({ register, }),);
const issueTickets = vi.fn(async (_id: string, lines: Array<{ tierName: string; priceCents: number; }>,) =>
    lines.map((l,) => ({ code: 'CODE', tierName: l.tierName, priceCents: l.priceCents, currency: 'USD', }))
);
const resolveTicketLines = vi.fn(async (lines: Array<Record<string, unknown>>,) => ({
    lines: lines.map((l,) => ({ ...l, eventTitle: 'Gala', tierName: 'VIP', priceCents: 9999, currency: 'USD', })),
    totalCents: 0,
}));
vi.mock('../events/tickets', () => ({ issueTickets, resolveTicketLines, }),);
const sendTicketConfirmation = vi.fn(async () => undefined);
vi.mock('../events/purchase', () => ({ sendTicketConfirmation, }),);

const { issueOrderTickets, } = await import('./ticketFulfillment');

const item = (over: Record<string, unknown> = {},) => ({
    id: 'i1',
    variantId: null,
    quantity: 2,
    isDigital: false,
    unitPriceCents: 1500,
    metadata: { kind: 'event_ticket', eventId: 'e1', occurrenceDate: '2026-10-01', tierId: 't1', ...over, },
});
const BUYER = { userId: 'u1', email: 'buyer@b.test', name: 'Buyer', };

beforeEach(() => {
    register.mockClear();
    issueTickets.mockClear();
    sendTicketConfirmation.mockClear();
},);

describe('issueOrderTickets', () => {
    it('registers the attendee and issues tickets at the paid price', async () => {
        await issueOrderTickets('o1', [item({ attendee: { email: 'guest@b.test', name: 'Guest', }, },),], BUYER,);
        expect(register.mock.calls[0][0],).toMatchObject({
            eventId: 'e1', occurrenceDate: '2026-10-01', email: 'guest@b.test', name: 'Guest', userId: 'u1',
        },);
        const lines = issueTickets.mock.calls[0][1];
        expect(lines[0],).toMatchObject({ tierId: 't1', quantity: 2, priceCents: 1500, },);
        expect(sendTicketConfirmation,).toHaveBeenCalledWith('e1', 'guest@b.test', expect.any(Array,),);
        expect(issueTickets.mock.calls[0][2],).toEqual({ orderId: 'o1', },);
    },);

    it('falls back to the order customer when the line names no attendee', async () => {
        await issueOrderTickets('o1', [item(),], BUYER,);
        expect(register.mock.calls[0][0],).toMatchObject({ email: 'buyer@b.test', name: 'Buyer', },);
    },);

    it('makes one registration per event date', async () => {
        await issueOrderTickets('o1', [
            item(),
            item({ tierId: 't2', },),
            item({ occurrenceDate: '2026-10-08', },),
        ], BUYER,);
        expect(register,).toHaveBeenCalledTimes(2,);
        expect(issueTickets.mock.calls[0][1],).toHaveLength(2,);
    },);

    it('never throws when issuing fails (payment is already captured)', async () => {
        issueTickets.mockRejectedValueOnce(new Error('Sold out',),);
        await expect(issueOrderTickets('o1', [item(),], BUYER,),).resolves.toBeUndefined();
        expect(sendTicketConfirmation,).not.toHaveBeenCalled();
    },);
},);
