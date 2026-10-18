import { describe, expect, it, } from 'vitest';
import { DEFAULT_EVENTS_BINDING, isEventsBlockType, normalizeEventsBlockSettings, truncateEventText, } from './eventsBlock';

describe('normalizeEventsBlockSettings', () => {
    it('fills every default (live upcoming query, grid of 3)', () => {
        const s = normalizeEventsBlockSettings({},);
        expect(s.binding,).toEqual(DEFAULT_EVENTS_BINDING,);
        expect(s,).toMatchObject({ source: 'data', layout: 'grid', columns: 3, columnsMobile: 1, itemsPerPage: 3, gap: '16px', showButton: true, },);
    });

    it('converts a legacy `event` block (eventId / eventSlug → a one-event list)', () => {
        expect(normalizeEventsBlockSettings({ eventId: 'abc', heading: 'Next up', },),).toMatchObject({
            binding: { mode: 'list', refs: ['abc',], }, heading: 'Next up',
        },);
        expect(normalizeEventsBlockSettings({ eventSlug: 'gala', },).binding,).toEqual({ mode: 'list', refs: ['gala',], },);
    });

    it('clamps and sanitises', () => {
        const s = normalizeEventsBlockSettings({ columns: 40, gap: '2rem;}', layout: 'nope', descriptionLength: -4, showImage: false, },);
        expect(s,).toMatchObject({ columns: 6, gap: '16px', layout: 'grid', descriptionLength: 200, showImage: false, },);
    });

    it('type alias', () => {
        expect(isEventsBlockType('event',),).toBe(true,);
        expect(isEventsBlockType('events',),).toBe(true,);
        expect(isEventsBlockType('gallery',),).toBe(false,);
    });
});

describe('truncateEventText', () => {
    it('cuts at a word boundary with an ellipsis', () => {
        expect(truncateEventText('The quick brown fox jumps over the lazy dog', 20,),).toBe('The quick brown fox…',);
        expect(truncateEventText('short', 20,),).toBe('short',);
        expect(truncateEventText('anything', 0,),).toBe('anything',);
    });
});
