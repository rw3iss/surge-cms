import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { EVENT_KIND, EVENT_LIST_KIND, isEntityRef, } from '@sitesurge/types';

const resolveMock = vi.fn();
vi.mock('../templateSlots', () => ({
    MAX_BINDING_RECORDS: 25,
    resolveBindingRecords: (...a: unknown[]) => resolveMock(...a),
}),);

import { EVENTS_RESOLVED_KEY, resolveEventFunction, resolveEventsBlockRecords, resolvedEventsOf, } from './serverRender';

const memo = <T,>(_k: string, fn: () => Promise<T>,) => fn();

describe('resolveEventFunction', () => {
    beforeEach(() => resolveMock.mockReset().mockResolvedValue([{ id: 'e1', title: 'Gala', },],),);

    it('ignores other names', async () => {
        const r = await resolveEventFunction('posts', [], undefined, memo, 'site',);
        expect(typeof r,).toBe('symbol',);
    });

    it("event('x') → one record (single binding), as the anonymous site reader", async () => {
        const r = await resolveEventFunction('event', ['gala',], {}, memo, 'site',);
        expect(resolveMock,).toHaveBeenCalledWith('event', { mode: 'single', ref: 'gala', }, 25, {},);
        expect(isEntityRef(r,) && r.kind,).toBe(EVENT_KIND,);
        expect(isEntityRef(r,) && r.data,).toEqual({ id: 'e1', title: 'Gala', },);
    });

    it('events(3, upcoming=false) in email → a list read with the email audience', async () => {
        const r = await resolveEventFunction('events', [3,], { upcoming: false, }, memo, 'email',);
        expect(resolveMock.mock.calls[0]![1],).toEqual({ mode: 'query', query: { filter: {}, sortBy: 'startsAt', sortOrder: 'asc', limit: 3, }, },);
        expect(resolveMock.mock.calls[0]![3],).toEqual({ audience: 'email', },);
        expect(isEntityRef(r,) && r.kind,).toBe(EVENT_LIST_KIND,);
        expect(isEntityRef(r,) && Array.isArray(r.data,),).toBe(true,);
    });

    it("event() with no ref → an empty ref, no read", async () => {
        const r = await resolveEventFunction('event', [], {}, memo, 'site',);
        expect(isEntityRef(r,) && r.data,).toBeNull();
        expect(resolveMock,).not.toHaveBeenCalled();
    });
});

describe('resolveEventsBlockRecords', () => {
    beforeEach(() => resolveMock.mockReset().mockResolvedValue([{ id: 'e1', },],),);

    it("a legacy `event` block's eventId reads that event", async () => {
        await resolveEventsBlockRecords({ eventId: 'abc', }, 'site',);
        expect(resolveMock.mock.calls[0]![1],).toEqual({ mode: 'list', refs: ['abc',], },);
    });

    it('slot / template sources are left to the pre-pass', async () => {
        expect(await resolveEventsBlockRecords({ source: 'slot', slotId: 's', }, 'email',),).toEqual([],);
        expect(resolveMock,).not.toHaveBeenCalled();
    });

    it('stashed records are read back', () => {
        expect(resolvedEventsOf({ [EVENTS_RESOLVED_KEY]: [{ id: 'x', },], },),).toEqual([{ id: 'x', },],);
        expect(resolvedEventsOf({},),).toEqual([],);
    });
});
