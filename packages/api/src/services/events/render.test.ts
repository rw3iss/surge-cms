import { describe, expect, it, } from 'vitest';
import { DEFAULT_EVENT_CARD_DISPLAY, type EventRecord, } from '@sitesurge/types';
import { eventCardsEmailHtml, eventCardsSsrHtml, formatEventPrice, } from './render';

function rec(over: Partial<EventRecord> = {},): EventRecord {
    return {
        id: 'e1', slug: 'gala', status: 'published', title: 'Gala <night>', url: 'https://site.test/events/gala', path: '/events/gala',
        externalUrl: null, description: '<p>x</p>', descriptionText: 'A long evening of music, food and dancing for everyone in town.',
        descriptionMarkdown: 'x', excerpt: 'A long evening', featuredImage: 'https://cdn.test/gala.jpg', startsAt: '2026-10-25T23:00:00.000Z',
        endsAt: null, allDay: false, timezone: 'America/New_York', nextOccurrence: '2026-10-25T23:00:00.000Z', nextOccurrenceEnd: null,
        occurrenceDate: '2026-10-25', when: 'Sunday…', dateLabel: 'Sun, Oct 25, 2026', timeLabel: '7:00 PM EDT', upcoming: true,
        recurrence: null, recurrenceLabel: '', isRecurring: false, location: 'Town Hall', ticketsEnabled: true, registrationOpen: true,
        registrationEnabled: true, isFree: false, priceFrom: 25, priceFromCents: 2500, currency: 'USD', capacity: 10, remaining: 3,
        soldOut: false,
        access: { view: 'public', register: 'members', viewTierName: null, registerTierName: null, tierName: null, badge: 'public', badgeLabel: 'Public', },
        isPublic: true, requiresSignIn: true, requiresTier: false,
        tiers: [{ id: 't', name: 'General', description: null, price: 25, priceCents: 2500, currency: 'USD', capacity: 10, sold: 7, remaining: 3, soldOut: false, maxPerOrder: null, requiredTierName: null, isFree: false, },],
        createdAt: '', updatedAt: '',
        ...over,
    };
}

const display = { ...DEFAULT_EVENT_CARD_DISPLAY, };

describe('formatEventPrice', () => {
    it('USD symbol, others suffixed', () => {
        expect(formatEventPrice(2500,),).toBe('$25.00',);
        expect(formatEventPrice(999, 'eur',),).toBe('9.99 EUR',);
    });
});

describe('eventCardsSsrHtml', () => {
    it('indexable article: linked + escaped title, time, location, button, sign-in line', () => {
        const html = eventCardsSsrHtml([rec(),], { ...display, showTickets: true, heading: 'Upcoming', },);
        expect(html,).toContain('<h2 style="text-align:center">Upcoming</h2>',);
        expect(html,).toContain('<a href="https://site.test/events/gala">Gala &lt;night&gt;</a>',);
        expect(html,).toContain('<time datetime="2026-10-25T23:00:00.000Z">Sun, Oct 25, 2026 · 7:00 PM EDT</time>',);
        expect(html,).toContain('Town Hall',);
        expect(html,).toContain('General — $25.00 · 3 left',);
        expect(html,).toContain('Sign in to register',);
        expect(html,).toContain('View event',);
    });

    it('respects toggles; empty list → nothing (or the empty text)', () => {
        const html = eventCardsSsrHtml([rec(),], { ...display, showImage: false, showLocation: false, showButton: false, showAccessBadge: false, },);
        expect(html,).not.toContain('<img',);
        expect(html,).not.toContain('Town Hall',);
        expect(html,).not.toContain('View event',);
        expect(eventCardsSsrHtml([], display,),).toBe('',);
        expect(eventCardsSsrHtml([], { ...display, emptyText: 'No events', },),).toContain('No events',);
    });

    it('cuts the description', () => {
        const html = eventCardsSsrHtml([rec(),], { ...display, descriptionLength: 20, },);
        expect(html,).toContain('A long evening of…',);
    });
});

describe('eventCardsEmailHtml', () => {
    const cellsPerRow = (html: string,) => (html.match(/<tr><td width=/g,) ?? []).length;

    it('grid: N columns per row (capped at 3), table-only markup', () => {
        const html = eventCardsEmailHtml([rec(), rec({ id: 'b', },), rec({ id: 'c', },), rec({ id: 'd', },),], { ...display, layout: 'grid', columns: 4, },);
        expect(html,).not.toMatch(/display:\s*(flex|grid)/,);
        expect(cellsPerRow(html,),).toBe(2,); // 4 cards / 3 per row → 2 rows
        expect(html,).toContain('width="189"',); // (600 - 2×16) / 3
    });

    it('column: one card per row, full width image', () => {
        const html = eventCardsEmailHtml([rec(), rec({ id: 'b', },),], { ...display, layout: 'column', },);
        expect(cellsPerRow(html,),).toBe(2,);
        expect(html,).toContain('width="600"',);
    });

    it('a list shorter than the columns uses its own count', () => {
        const html = eventCardsEmailHtml([rec(),], { ...display, layout: 'grid', columns: 3, }, { width: 560, },);
        expect(html,).toContain('width="560"',);
    });

    it('button links to the event page in the link colour; badge is a pill; escaped', () => {
        const html = eventCardsEmailHtml([rec(),], { ...display, buttonLabel: 'Get <tickets>', }, { linkColor: '#ff0000', radius: '4px', },);
        expect(html,).toContain('href="https://site.test/events/gala" style="display:inline-block;padding:10px 18px;background:#ff0000',);
        expect(html,).toContain('Get &lt;tickets&gt;',);
        expect(html,).toContain('>Public</span>',);
        expect(html,).toContain('Gala &lt;night&gt;',);
    });
});
