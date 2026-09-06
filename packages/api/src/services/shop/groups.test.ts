/**
 * Fulfilment grouping — the rules the whole multi-cart model rests on.
 */
import { describe, expect, it, } from 'vitest';
import {
    buildGroups, groupKeyForLine, groupLines, NATIVE_GROUP, TICKETS_GROUP,
} from './groups';
import type { ResolvedLine, } from './checkout';

function line(over: Partial<ResolvedLine> & { variantId: string; },): ResolvedLine {
    return {
        productId: 'p', qty: 1, unitPriceCents: 1000, subtotalCents: 1000,
        title: 't', variantTitle: null, sku: null, isDigital: false,
        requiresShipping: true, shippingType: 'flat', useDefaultShipping: true,
        variantShippingCents: 0, externalProvider: null,
        externalProductId: null, externalVariantId: null,
        ...over,
    } as ResolvedLine;
}

describe('groupKeyForLine', () => {
    it('puts self-fulfilled stock in the native group', () => {
        expect(groupKeyForLine(line({ variantId: 'a', },),),).toBe(NATIVE_GROUP,);
    },);

    it('groups by the provider that will ship it', () => {
        expect(groupKeyForLine(line({ variantId: 'a', externalProvider: 'printify', },),),).toBe('printify',);
        expect(groupKeyForLine(line({ variantId: 'b', externalProvider: 'apliiq', },),),).toBe('apliiq',);
    },);

    it('separates event tickets, which are never shipped', () => {
        // Lumping a ticket with native stock would put a postage charge on it.
        const ticket = line({ variantId: 'event:1:2026-01-01:t', },) as ResolvedLine & { kind: string; };
        ticket.kind = 'event_ticket';
        expect(groupKeyForLine(ticket,),).toBe(TICKETS_GROUP,);
    },);
},);

describe('groupLines', () => {
    it('returns one group for a single-supplier cart', () => {
        const g = groupLines([
            line({ variantId: 'a', externalProvider: 'printify', },),
            line({ variantId: 'b', externalProvider: 'printify', },),
        ],);
        expect([...g.keys(),],).toEqual(['printify',],);
        expect(g.get('printify',)!.length,).toBe(2,);
    },);

    it('splits a mixed cart into one group per fulfiller', () => {
        const g = groupLines([
            line({ variantId: 'a', externalProvider: 'printify', },),
            line({ variantId: 'b', },),
            line({ variantId: 'c', externalProvider: 'apliiq', },),
        ],);
        expect([...g.keys(),].sort(),).toEqual(['apliiq', 'native', 'printify',],);
    },);

    it('orders native first, then suppliers, then tickets', () => {
        // Stable order matters: the buyer sees these as sections and the admin
        // sees them in emails.
        const ticket = line({ variantId: 't', },) as ResolvedLine & { kind: string; };
        ticket.kind = 'event_ticket';
        const g = groupLines([
            ticket,
            line({ variantId: 'a', externalProvider: 'printify', },),
            line({ variantId: 'b', },),
            line({ variantId: 'c', externalProvider: 'apliiq', },),
        ],);
        expect([...g.keys(),],).toEqual(['native', 'apliiq', 'printify', 'event_tickets',],);
    },);

    it('has no groups for an empty cart', () => {
        expect(groupLines([],).size,).toBe(0,);
    },);
},);

describe('buildGroups', () => {
    it('sums each group\'s subtotal independently', () => {
        const groups = buildGroups([
            line({ variantId: 'a', externalProvider: 'printify', subtotalCents: 2500, },),
            line({ variantId: 'b', externalProvider: 'printify', subtotalCents: 1500, },),
            line({ variantId: 'c', subtotalCents: 999, },),
        ],);
        const byKey = Object.fromEntries(groups.map((g,) => [g.key, g.subtotalCents,]),);
        expect(byKey.printify,).toBe(4000,);
        expect(byKey.native,).toBe(999,);
    },);

    it('flags supplier groups so only those become provider orders', () => {
        const groups = buildGroups([
            line({ variantId: 'a', externalProvider: 'apliiq', },),
            line({ variantId: 'b', },),
        ],);
        expect(groups.find((g,) => g.key === 'apliiq',)!.isProvider,).toBe(true,);
        expect(groups.find((g,) => g.key === NATIVE_GROUP,)!.isProvider,).toBe(false,);
    },);

    it('labels the native group with the business name', () => {
        const groups = buildGroups([line({ variantId: 'a', },),], 'Surge Media',);
        expect(groups[0].label,).toBe('Surge Media',);
    },);

    it('falls back to a generic label when no business name is set', () => {
        expect(buildGroups([line({ variantId: 'a', },),],)[0].label,).toBe('Our store',);
    },);

    it('labels supplier groups from the registry', () => {
        const groups = buildGroups([line({ variantId: 'a', externalProvider: 'apliiq', },),],);
        expect(groups[0].label,).toBe('Apliiq',);
    },);

    it('falls back to the raw key for a provider no longer registered', () => {
        // An old order must still render after a provider is removed.
        const groups = buildGroups([line({ variantId: 'a', externalProvider: 'gone', },),],);
        expect(groups[0].label,).toBe('gone',);
    },);
},);
