import { describe, expect, it, } from 'vitest';
import {
    eventAccessBadge, eventDateTime, eventExcerpt, eventRecordHref, eventsBindingIsEmpty, eventsGridColumns, eventsGridTemplate, eventsPerPage,
    tierAvailability, tierPrice, visibleTiers,
} from './eventsLayout';

describe('layout geometry', () => {
    it('grid: desktop / mobile columns', () => {
        expect(eventsGridColumns(3, 1, false,),).toBe(3,);
        expect(eventsGridColumns(3, 1, true,),).toBe(1,);
        expect(eventsGridColumns(3, 2, true,),).toBe(2,);
        // Fewer events than columns → one column per event.
        expect(eventsGridColumns(3, 1, false, 1,),).toBe(1,);
        expect(eventsGridColumns(3, 1, false, 2,),).toBe(2,);
        expect(eventsGridColumns(3, 1, false, 7,),).toBe(3,);
        expect(eventsGridColumns(3, 2, true, 1,),).toBe(1,);
        expect(eventsGridTemplate(2,),).toBe('repeat(2, minmax(0, 1fr))',);
        expect(eventsGridTemplate(2, '300px',),).toBe('repeat(2, minmax(0, 300px))',);
    },);
    it('row: per page capped by the count; mobile value on mobile', () => {
        expect(eventsPerPage(3, 1, false, 10,),).toBe(3,);
        expect(eventsPerPage(3, 1, false, 2,),).toBe(2,);
        expect(eventsPerPage(3, 1, true, 10,),).toBe(1,);
        expect(eventsPerPage(3, 1, false, 0,),).toBe(1,);
    },);
},);

describe('eventAccessBadge', () => {
    it('public view → globe; sign-in hint when registration needs an account', () => {
        expect(eventAccessBadge({ isPublic: true, requiresSignIn: false, },),).toEqual({ kind: 'public', label: 'Public', signInToRegister: false, },);
        expect(eventAccessBadge({ requiresSignIn: true, },).signInToRegister,).toBe(true,);
    },);
    it('members / tier → lock, with the provider label', () => {
        const access = (view: 'members' | 'tier', badgeLabel: string, tierName: string | null = null,) => ({
            view, register: view, viewTierName: tierName, registerTierName: tierName, tierName, badge: view, badgeLabel,
        });
        expect(eventAccessBadge({ access: access('members', 'Members',), },),).toMatchObject({ kind: 'locked', label: 'Members', },);
        expect(eventAccessBadge({ access: access('tier', 'Subscribers (Gold)', 'Gold',), },).label,).toBe('Subscribers (Gold)',);
        expect(eventAccessBadge({ access: access('tier', '', 'Gold',), },).label,).toBe('Subscribers (Gold)',);
        expect(eventAccessBadge({ isPublic: false, },).kind,).toBe('locked',);
    },);
    it('no access info = public', () => {
        expect(eventAccessBadge({},).kind,).toBe('public',);
    },);
},);

describe('tiers', () => {
    it('availability', () => {
        expect(tierAvailability({ name: 'A', remaining: 0, },),).toBe('Sold out',);
        expect(tierAvailability({ name: 'A', soldOut: true, remaining: 3, },),).toBe('Sold out',);
        expect(tierAvailability({ name: 'A', remaining: 5, },),).toBe('5 left',);
        expect(tierAvailability({ name: 'A', remaining: null, },),).toBeNull();
    },);
    it('price', () => {
        expect(tierPrice({ name: 'A', priceCents: 0, },),).toBe('Free',);
        expect(tierPrice({ name: 'A', priceCents: 2500, currency: 'usd', },),).toBe('$25.00',);
        expect(tierPrice({ name: 'A', price: 10, },),).toBe('$10.00',);
    },);
    it('hidden when ticketing is off', () => {
        const tiers = [{ name: 'GA', } as never,];
        expect(visibleTiers({ tiers, },),).toHaveLength(1,);
        expect(visibleTiers({ tiers, ticketsEnabled: false, },),).toHaveLength(0,);
        expect(visibleTiers({},),).toHaveLength(0,);
    },);
},);

describe('card text', () => {
    it('excerpt truncates on a word boundary', () => {
        const e = { descriptionText: 'The quick brown fox jumps over the lazy dog', };
        expect(eventExcerpt(e, 200,),).toBe('The quick brown fox jumps over the lazy dog',);
        expect(eventExcerpt(e, 20,),).toBe('The quick brown fox…',);
        expect(eventExcerpt({ description: '<p>Hi <b>there</b></p>', }, 50,),).toBe('Hi there',);
    },);
    it('href prefers the site-relative path', () => {
        expect(eventRecordHref({ path: '/events/x', url: 'https://s/events/x', },),).toBe('/events/x',);
        expect(eventRecordHref({ url: 'https://s/events/y', },),).toBe('https://s/events/y',);
        expect(eventRecordHref({ slug: 'gala', },),).toBe('/events/gala',);
    },);
    it('date + time: labels win; else the event zone; all-day', () => {
        expect(eventDateTime({ dateLabel: 'Sat, Oct 18', timeLabel: '7:00 PM', },),).toEqual({ date: 'Sat, Oct 18', time: '7:00 PM', },);
        const t = eventDateTime({ startsAt: '2026-10-18T23:00:00Z', timezone: 'America/New_York', },);
        expect(t.date,).toContain('Oct 18',);
        expect(t.time,).toMatch(/7:00\sPM/,);
        expect(eventDateTime({ startsAt: '2026-10-18T00:00:00Z', allDay: true, },),).toEqual({ date: 'Sun, Oct 18, 2026', time: 'All day', },);
    },);
},);

describe('eventsBindingIsEmpty', () => {
    it('empty only for a data source with an empty selection', () => {
        expect(eventsBindingIsEmpty({},),).toBe(false,); // default upcoming query
        expect(eventsBindingIsEmpty({ eventId: 'e1', },),).toBe(false,); // legacy event block
        expect(eventsBindingIsEmpty({ binding: { mode: 'list', refs: [], }, },),).toBe(true,);
        expect(eventsBindingIsEmpty({ binding: { mode: 'single', ref: '', }, },),).toBe(true,);
        expect(eventsBindingIsEmpty({ binding: { mode: 'list', refs: ['a',], }, },),).toBe(false,);
        expect(eventsBindingIsEmpty({ source: 'slot', },),).toBe(false,);
    },);
},);
