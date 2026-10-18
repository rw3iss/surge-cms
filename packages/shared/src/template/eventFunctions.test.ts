import { describe, expect, it, } from 'vitest';
import { eventDisplayFrom, eventsCallFor, } from './eventFunctions';

describe('eventsCallFor', () => {
    it('event(ref) → one record by id or slug', () => {
        expect(eventsCallFor('event', ['summer-gala',],),).toEqual({ single: true, binding: { mode: 'single', ref: 'summer-gala', }, },);
        expect(eventsCallFor('event', [],),).toBeNull();
        expect(eventsCallFor('posts', [],),).toBeNull();
    });

    it('events() → upcoming, soonest first, 6', () => {
        expect(eventsCallFor('events', [],),).toEqual({
            single: false,
            binding: { mode: 'query', query: { filter: { upcoming: true, }, sortBy: 'startsAt', sortOrder: 'asc', limit: 6, }, },
        },);
    });

    it('events(3, upcoming=false, sort=title, order=desc, access=public, search=…)', () => {
        const c = eventsCallFor('events', [3,], { upcoming: false, sort: 'title', order: 'desc', access: 'public', search: 'gala', },);
        expect(c?.binding,).toEqual({
            mode: 'query',
            query: { filter: { access: 'public', }, sortBy: 'title', sortOrder: 'desc', limit: 3, search: 'gala', },
        },);
    });

    it('ids= → those events in order; limit caps at 50', () => {
        expect(eventsCallFor('events', [], { ids: 'a, b ,c', },)?.binding,).toEqual({ mode: 'list', refs: ['a', 'b', 'c',], },);
        const q = eventsCallFor('events', [999,],)?.binding;
        expect(q?.mode === 'query' && q.query.limit,).toBe(50,);
    });
});

describe('eventDisplayFrom', () => {
    it('defaults', () => {
        const d = eventDisplayFrom();
        expect(d,).toMatchObject({ layout: 'grid', columns: 3, gap: '16px', showImage: true, showTickets: false, showButton: true, buttonLabel: 'View event', descriptionLength: 200, },);
    });

    it('named args toggle parts', () => {
        const d = eventDisplayFrom({ image: false, tickets: 'true', badge: 0, buttonLabel: 'Get tickets', descriptionLength: 80, layout: 'column', columns: 9, gap: 8, },);
        expect(d,).toMatchObject({ showImage: false, showTickets: true, showAccessBadge: false, buttonLabel: 'Get tickets', descriptionLength: 80, layout: 'column', columns: 6, gap: '8px', },);
    });

    it('row is not a template layout (reads as grid); unsafe gap ignored', () => {
        expect(eventDisplayFrom({ layout: 'row', gap: '1px;color:red', },),).toMatchObject({ layout: 'grid', gap: '16px', },);
    });
});
