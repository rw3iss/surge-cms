import { describe, expect, it, vi, beforeEach, } from 'vitest';

/**
 * Ticket pricing is the security-critical path: the cart lives in the browser,
 * so a tampered price or quantity must not be able to change what someone pays
 * or oversell an event. These tests pin that the resolver ignores the cart's
 * figures entirely and reads the database instead.
 */

const findById = vi.fn();
const findTierById = vi.fn();
const countSoldByTier = vi.fn();

vi.mock('../../repositories/events.repo', () => ({
    findById: (...a: unknown[]) => findById(...a),
    findTierById: (...a: unknown[]) => findTierById(...a),
    countSoldByTier: (...a: unknown[]) => countSoldByTier(...a),
}),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);

const { resolveTicketLines, } = await import('./tickets');

const EVENT = {
    id: 'e1', title: 'Gala', status: 'published', ticketingEnabled: true,
};
const TIER = {
    id: 't1', eventId: 'e1', name: 'General', priceCents: 2500,
    currency: 'USD', quantityAvailable: null,
};

function line(over: Record<string, unknown> = {},) {
    return {
        kind: 'event_ticket' as const, eventId: 'e1', occurrenceDate: '2026-09-01',
        tierId: 't1', name: 'General', priceCents: 2500, currency: 'USD',
        quantity: 2, ...over,
    };
}

beforeEach(() => {
    findById.mockResolvedValue(EVENT,);
    findTierById.mockResolvedValue(TIER,);
    countSoldByTier.mockResolvedValue({},);
},);

describe('resolveTicketLines', () => {
    it('prices from the DATABASE, ignoring the price the cart claimed', async () => {
        // The cart says 1p; the tier says $25. The customer pays $25.
        const { lines, totalCents, } = await resolveTicketLines([line({ priceCents: 1, },),] as never,);
        expect(lines[0].priceCents,).toBe(2500,);
        expect(totalCents,).toBe(5000,); // 2 × $25, not 2 × 1p
    },);

    it('rejects a quantity below 1', async () => {
        await expect(resolveTicketLines([line({ quantity: 0, },),] as never,),)
            .rejects.toThrow(/at least 1/i,);
    },);

    it('rejects a tier belonging to a DIFFERENT event', async () => {
        findTierById.mockResolvedValue({ ...TIER, eventId: 'someone-else', },);
        await expect(resolveTicketLines([line(),] as never,),)
            .rejects.toThrow(/no longer available/i,);
    },);

    it('refuses when the event is not published', async () => {
        findById.mockResolvedValue({ ...EVENT, status: 'draft', },);
        await expect(resolveTicketLines([line(),] as never,),)
            .rejects.toThrow(/not open for ticket sales/i,);
    },);

    it('refuses when the event is not selling tickets', async () => {
        findById.mockResolvedValue({ ...EVENT, ticketingEnabled: false, },);
        await expect(resolveTicketLines([line(),] as never,),)
            .rejects.toThrow(/not selling tickets/i,);
    },);

    it('refuses to oversell a capped tier', async () => {
        findTierById.mockResolvedValue({ ...TIER, quantityAvailable: 10, },);
        countSoldByTier.mockResolvedValue({ t1: 9, },); // 1 left, 2 requested
        await expect(resolveTicketLines([line(),] as never,),)
            .rejects.toThrow(/Only 1 .* left/i,);
    },);

    it('reports a sold-out tier distinctly from a partial shortfall', async () => {
        findTierById.mockResolvedValue({ ...TIER, quantityAvailable: 10, },);
        countSoldByTier.mockResolvedValue({ t1: 10, },);
        await expect(resolveTicketLines([line(),] as never,),)
            .rejects.toThrow(/sold out/i,);
    },);

    it('allows an unlimited tier through with remaining = null', async () => {
        const { lines, } = await resolveTicketLines([line({ quantity: 99, },),] as never,);
        expect(lines[0].remaining,).toBeNull();
    },);

    it('counts inventory PER OCCURRENCE, not per event', async () => {
        findTierById.mockResolvedValue({ ...TIER, quantityAvailable: 10, },);
        countSoldByTier.mockResolvedValue({ t1: 10, },);
        await resolveTicketLines([line({ occurrenceDate: '2026-09-08', },),] as never,)
            .catch(() => { /* expected: that date is also full in this stub */ },);
        // The lookup must be scoped to the requested date.
        expect(countSoldByTier,).toHaveBeenCalledWith('e1', '2026-09-08',);
    },);

    it('sums a multi-tier order from DB prices', async () => {
        findTierById
            .mockResolvedValueOnce({ ...TIER, priceCents: 2500, },)
            .mockResolvedValueOnce({ ...TIER, id: 't2', priceCents: 5000, },);
        const { totalCents, } = await resolveTicketLines([
            line({ quantity: 2, },),
            line({ tierId: 't2', quantity: 1, },),
        ] as never,);
        expect(totalCents,).toBe(2 * 2500 + 5000,);
    },);
},);
