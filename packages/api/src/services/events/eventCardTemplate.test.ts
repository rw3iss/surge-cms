/**
 * The seeded Event Card template must render cleanly through the real
 * `{{ }}` engine against an EventRecord: title linked, tiers looped, badge,
 * sign-in line, and values escaped.
 */
import { describe, expect, it, } from 'vitest';
import { entityRef, renderTemplateToString, resolveValueFunction, type TemplateRuntime, UNRESOLVED, } from '@sitesurge/types';
import { EVENT_CARD_TEMPLATE_HTML, } from './eventCardTemplate';

function runtimeFor(event: Record<string, unknown>,): TemplateRuntime {
    return { context: { event: entityRef('event', event, String(event.id,),), }, resolve: async (name, args,) => {
        // Value functions (truncate, formatCurrency, default…) as every runtime resolves them.
        const v = resolveValueFunction(name, args,);
        return v === UNRESOLVED ? undefined : v;
    }, };
}

const base = {
    id: 'e1', title: 'Gala <b>', url: 'https://site.test/events/gala', featuredImage: 'https://cdn.test/g.jpg',
    featuredMedia: { path: 'https://cdn.test/g.jpg', alt: 'Dancers', },
    nextOccurrence: '2026-10-25T23:00:00.000Z', dateLabel: 'Sun, Oct 25, 2026', timeLabel: '7:00 PM EDT', recurrenceLabel: '',
    location: 'Town Hall', descriptionText: 'Music & food.', isPublic: true, requiresSignIn: true, registrationOpen: true,
    access: { badgeLabel: 'Public', },
    tiers: [
        { name: 'General', isFree: false, price: 25, remaining: 3, soldOut: false, },
        { name: 'Kids', isFree: true, price: 0, remaining: null, soldOut: false, },
        { name: 'VIP', isFree: false, price: 100, remaining: 0, soldOut: true, },
    ],
};

describe('Event Card template', () => {
    it('renders every part', async () => {
        const html = await renderTemplateToString(EVENT_CARD_TEMPLATE_HTML, runtimeFor(base,), () => '',);
        expect(html,).toContain('<a href="https://site.test/events/gala">Gala &lt;b&gt;</a>',);
        expect(html,).toContain('alt="Dancers"',);
        expect(html,).toContain('ss-event-card--has-image',);
        expect(html,).toContain('Sun, Oct 25, 2026 · 7:00 PM EDT',);
        expect(html,).toContain('Town Hall',);
        expect(html,).toContain('Music &amp; food.',);
        expect(html,).toContain('$25.00',);
        expect(html,).toContain('· 3 left',);
        expect(html,).toContain('Free',);
        expect(html,).toContain('· Sold out',);
        expect(html,).toContain('Sign in to register',);
        expect(html,).toMatch(/<\/svg> Public<\/span>/,);
        expect(html,).toContain('View event',);
        expect(html,).not.toContain('{{',);
        expect(html,).toContain('@layer theme',);
    });

    it('a members event without image / tickets', async () => {
        const html = await renderTemplateToString(EVENT_CARD_TEMPLATE_HTML, runtimeFor({
            ...base, featuredImage: null, featuredMedia: null, tiers: [], isPublic: false, access: { badgeLabel: 'Subscribers (Gold)', },
        },), () => '',);
        expect(html,).not.toContain('<img',);
        expect(html,).not.toContain('ss-event-card__tiers"',);
        expect(html,).toContain('Subscribers (Gold)',);
        expect(html,).not.toContain('Sign in to register',);
    });
});
