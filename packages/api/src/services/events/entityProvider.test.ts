/**
 * The `event` entity provider: record enrichment (tiers, remaining, access,
 * next occurrence + labels) and VIEWER GATING of entity lists (anonymous vs
 * member vs staff — applied in SQL so totals stay right).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';
import type { CalendarEvent, EventsSettings, EventTicketTier, } from '@sitesurge/types';
import { DEFAULT_EVENTS_SETTINGS, } from '@sitesurge/types';

const listMock = vi.fn();
const getByIdMock = vi.fn();
vi.mock('../../repositories/genericEntity.repo', () => ({
    list: (...a: unknown[]) => listMock(...a),
    getById: (...a: unknown[]) => getByIdMock(...a),
    getBySlug: vi.fn(),
}),);
vi.mock('../../entities/entityManager', () => ({
    requireType: () => ({ key: 'event', tableName: 'events', hasStatus: true, hasSlug: true, fields: [], }),
}),);

const repoMock = vi.hoisted(() => ({
    findByIds: vi.fn(),
    findById: vi.fn(),
    findOverridesForEvents: vi.fn(),
    findTiersForEvents: vi.fn(),
    countSoldForOccurrences: vi.fn(),
}),);
vi.mock('../../repositories/events.repo', () => repoMock,);

let settings: EventsSettings = { ...DEFAULT_EVENTS_SETTINGS, };
vi.mock('./settings', () => ({ getSettings: async () => settings, }),);
vi.mock('../settings', () => ({ getPublicSettings: async () => ({ defaults: { timezone: 'America/New_York', }, }), }),);
vi.mock('../postGate', () => ({
    tiersById: async () => new Map([['gold', { id: 'gold', name: 'Gold', sortOrder: 2, },],],),
}),);
const levelMock = vi.fn();
vi.mock('../access/level', () => ({
    viewerLevel: (...a: unknown[]) => levelMock(...a),
    floorFor: async (rule: string,) => (rule === 'public' ? -1 : rule === 'members' ? 0 : 2),
    refusalReason: () => null,
    tierInfo: async () => null,
}),);
vi.mock('../../config', () => ({ config: { frontendUrl: 'https://site.test', }, }),);

import {
    accessOf, buildEventRecord, eventEntityProvider, nextOccurrenceOf, occurrenceLabels, recurrenceLabelOf, viewFloorCondition,
} from './entityProvider';

const NOW = new Date('2026-10-18T12:00:00.000Z',);

function ev(over: Partial<CalendarEvent> = {},): CalendarEvent {
    return {
        id: 'e1', title: 'Summer Gala', slug: 'summer-gala', description: 'A **grand** night out with music and food.',
        startsAt: '2026-10-25T23:00:00.000Z', endsAt: '2026-10-26T01:00:00.000Z', allDay: false, location: 'Town Hall',
        url: 'https://tickets.example', featuredImage: '/uploads/gala.jpg', status: 'published', timezone: 'America/New_York',
        recurrenceRule: null, recurrenceUntil: null, registrationEnabled: true, registrationFields: ['email',],
        showRegistrantCount: false, ticketingEnabled: true, viewAccess: 'inherit', viewMinTierId: null,
        registerAccess: 'inherit', registerMinTierId: null, metadata: {}, createdBy: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
    };
}

function tier(over: Partial<EventTicketTier> = {},): EventTicketTier {
    return {
        id: 't1', eventId: 'e1', name: 'General', priceCents: 2500, currency: 'USD', quantityAvailable: 100,
        position: 0, requiredTierId: null, maxPerOrder: null, description: null, ...over,
    };
}

const baseInput = (over: Partial<Parameters<typeof buildEventRecord>[0]> = {},) => ({
    base: { id: 'e1', extraField: 'kept', },
    event: ev(),
    overrides: [],
    tiers: [tier(), tier({ id: 't2', name: 'VIP <b>', priceCents: 10000, quantityAvailable: 10, requiredTierId: 'gold', description: 'Front <row>', },),],
    sold: { t1: 40, t2: 10, },
    settings: { ...DEFAULT_EVENTS_SETTINGS, allowTicketing: true, },
    tierInfo: new Map([['gold', { id: 'gold', name: 'Gold', sortOrder: 2, },],],),
    siteZone: 'America/New_York',
    origin: 'https://site.test',
    now: NOW,
    ...over,
});

describe('nextOccurrenceOf', () => {
    it('a one-off: itself, upcoming until it ends', () => {
        const n = nextOccurrenceOf(ev(), [], NOW,);
        expect(n.start.toISOString(),).toBe('2026-10-25T23:00:00.000Z',);
        expect(n.upcoming,).toBe(true,);
        expect(nextOccurrenceOf(ev({ startsAt: '2026-01-01T10:00:00.000Z', endsAt: null, },), [], NOW,).upcoming,).toBe(false,);
    });

    it('a weekly series: the next date that has not ended', () => {
        const n = nextOccurrenceOf(ev({ startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z', recurrenceRule: 'weekly', },), [], NOW,);
        expect(n.upcoming,).toBe(true,);
        expect(n.date,).toBe('2026-10-19',); // Mondays
        expect(n.start.getTime(),).toBeGreaterThan(NOW.getTime(),);
    });

    it('skips a cancelled date', () => {
        const n = nextOccurrenceOf(
            ev({ startsAt: '2026-01-05T15:00:00.000Z', endsAt: '2026-01-05T16:00:00.000Z', recurrenceRule: 'weekly', },),
            [{ id: 'o', eventId: 'e1', occurrenceDate: '2026-10-19', status: 'cancelled', startsAtOverride: null, endsAtOverride: null, titleOverride: null, },],
            NOW,
        );
        expect(n.date,).toBe('2026-10-26',);
    });
});

describe('labels', () => {
    it('formats date + time in the event zone', () => {
        const l = occurrenceLabels({ start: new Date('2026-10-25T23:00:00.000Z',), end: new Date('2026-10-26T01:00:00.000Z',), }, false, 'America/New_York',);
        expect(l.dateLabel,).toBe('Sun, Oct 25, 2026',);
        expect(l.timeLabel,).toBe('7:00 PM – 9:00 PM EDT',);
        expect(l.when,).toContain('Sunday, October 25, 2026',);
    });

    it('all day', () => {
        const l = occurrenceLabels({ start: new Date('2026-10-25T00:00:00.000Z',), end: null, }, true, 'America/New_York',);
        expect(l.timeLabel,).toBe('All day',);
        expect(l.dateLabel,).toBe('Sun, Oct 25, 2026',);
    });

    it('recurrence label', () => {
        expect(recurrenceLabelOf('weekly',),).toBe('Every week',);
        expect(recurrenceLabelOf(null,),).toBe('',);
    });
});

describe('accessOf', () => {
    const s = DEFAULT_EVENTS_SETTINGS;
    const tiers = new Map([['gold', { id: 'gold', name: 'Gold', sortOrder: 2, },],],);

    it('inherit → the Settings → Events default', () => {
        const a = accessOf(ev(), { ...s, viewAccess: 'members', }, tiers,);
        expect(a.view,).toBe('members',);
        expect(a.badgeLabel,).toBe('Members',);
    });

    it('a tier rule names the tier in the badge', () => {
        const a = accessOf(ev({ viewAccess: 'tier', viewMinTierId: 'gold', },), s, tiers,);
        expect(a.badge,).toBe('tier',);
        expect(a.badgeLabel,).toBe('Subscribers (Gold)',);
        expect(a.tierName,).toBe('Gold',);
    });
});

describe('buildEventRecord', () => {
    it('enriches tiers with remaining / sold out / price, and totals', () => {
        const r = buildEventRecord(baseInput(),);
        expect(r.url,).toBe('https://site.test/events/summer-gala',);
        expect(r.path,).toBe('/events/summer-gala',);
        expect(r.externalUrl,).toBe('https://tickets.example',);
        expect(r.extraField,).toBe('kept',);
        expect(r.ticketsEnabled,).toBe(true,);
        expect(r.tiers.map((t,) => [t.name, t.price, t.remaining, t.soldOut,]),).toEqual([
            ['General', 25, 60, false,], ['VIP <b>', 100, 0, true,],
        ],);
        expect(r.tiers[1]!.requiredTierName,).toBe('Gold',);
        // Tier descriptions are escaped (a trusted template field).
        expect(r.tiers[1]!.description,).toBe('Front &lt;row&gt;',);
        expect(r.capacity,).toBe(110,);
        expect(r.remaining,).toBe(60,);
        expect(r.soldOut,).toBe(false,);
        expect(r.priceFrom,).toBe(25,);
        expect(r.isFree,).toBe(false,);
        expect(r.description,).toContain('<strong>grand</strong>',);
        expect(r.descriptionText,).toBe('A grand night out with music and food.',);
        expect(r.registrationOpen,).toBe(true,);
        expect(r.dateLabel,).toBe('Sun, Oct 25, 2026',);
    });

    it('an unlimited tier → no total capacity; ticketing off in settings → no tiers', () => {
        const r = buildEventRecord(baseInput({ tiers: [tier({ quantityAvailable: null, },),], sold: {}, },),);
        expect(r.capacity,).toBeNull();
        expect(r.remaining,).toBeNull();
        expect(r.tiers[0]!.remaining,).toBeNull();
        const off = buildEventRecord(baseInput({ settings: { ...DEFAULT_EVENTS_SETTINGS, allowTicketing: false, }, },),);
        expect(off.tiers,).toEqual([],);
        expect(off.ticketsEnabled,).toBe(false,);
        expect(off.isFree,).toBe(true,);
        expect(off.priceFrom,).toBeNull();
    });

    it('sold out when every capped tier is gone', () => {
        const r = buildEventRecord(baseInput({ sold: { t1: 100, t2: 10, }, },),);
        expect(r.soldOut,).toBe(true,);
        expect(r.remaining,).toBe(0,);
    });

    it('access flags: public view + members registration → "sign in to register"', () => {
        const r = buildEventRecord(baseInput({ event: ev({ viewAccess: 'public', registerAccess: 'members', },), },),);
        expect(r.isPublic,).toBe(true,);
        expect(r.requiresSignIn,).toBe(true,);
        expect(r.requiresTier,).toBe(false,);
        expect(r.access.badgeLabel,).toBe('Public',);
    });
});

describe('viewFloorCondition', () => {
    it('compares the event floor with the viewer level, parameterized', () => {
        const params: unknown[] = [];
        const sql = viewFloorCondition({ viewAccess: 'tier', viewMinTierId: 'gold', }, 0,)(params,);
        expect(sql,).toMatch(/<= \$3::int$/,);
        expect(params,).toEqual(['tier', 'gold', 0,],);
    });
});

describe('eventEntityProvider.list — viewer gating', () => {
    beforeEach(() => {
        settings = { ...DEFAULT_EVENTS_SETTINGS, };
        listMock.mockReset().mockResolvedValue({ items: [], total: 0, },);
        levelMock.mockReset();
        for (const m of Object.values(repoMock,)) m.mockReset();
        repoMock.findByIds.mockResolvedValue([],);
        repoMock.findOverridesForEvents.mockResolvedValue(new Map(),);
        repoMock.findTiersForEvents.mockResolvedValue(new Map(),);
        repoMock.countSoldForOccurrences.mockResolvedValue({},);
    });

    const conditionsOf = (call: unknown[],) => ((call[2] as { extraWhere?: Array<(p: unknown[],) => string>; }).extraWhere ?? []);
    const levelParam = (call: unknown[],): unknown => {
        const params: unknown[] = [];
        const sqls = conditionsOf(call,).map((c,) => c(params,));
        const idx = sqls.findIndex((s,) => s.includes('sort_order',),);
        return idx < 0 ? undefined : params[params.length - 1];
    };

    it('anonymous: published only, level -1', async () => {
        levelMock.mockResolvedValue(-1,);
        await eventEntityProvider.list!({}, {},);
        const call = listMock.mock.calls[0]!;
        expect((call[1] as { status?: string; }).status,).toBe('published',);
        expect(levelParam(call,),).toBe(-1,);
    });

    it('a member: level 0', async () => {
        levelMock.mockResolvedValue(0,);
        await eventEntityProvider.list!({}, { viewer: { id: 'u1', role: 'member', }, },);
        expect(levelParam(listMock.mock.calls[0]!,),).toBe(0,);
    });

    it('staff (level ∞): no view condition', async () => {
        levelMock.mockResolvedValue(Infinity,);
        await eventEntityProvider.list!({}, { viewer: { id: 's', role: 'editor', }, },);
        expect(levelParam(listMock.mock.calls[0]!,),).toBeUndefined();
    });

    it('admin read: every status, no gate', async () => {
        await eventEntityProvider.list!({ status: 'draft', }, { admin: true, },);
        const call = listMock.mock.calls[0]!;
        expect((call[1] as { status?: string; }).status,).toBe('draft',);
        expect(levelParam(call,),).toBeUndefined();
        expect(levelMock,).not.toHaveBeenCalled();
    });

    it('email audience reads as anonymous', async () => {
        await eventEntityProvider.list!({}, { audience: 'email', viewer: { id: 'u1', role: 'member', }, },);
        expect(levelParam(listMock.mock.calls[0]!,),).toBe(-1,);
        expect(levelMock,).not.toHaveBeenCalled();
    });

    it('the `upcoming` virtual filter becomes a SQL condition', async () => {
        levelMock.mockResolvedValue(-1,);
        await eventEntityProvider.list!({ filter: { upcoming: true, }, }, {},);
        const call = listMock.mock.calls[0]!;
        const sqls = conditionsOf(call,).map((c,) => c([],));
        expect(sqls.some((s,) => s.includes('"recurrence_rule" IS NOT NULL',)),).toBe(true,);
        expect((call[1] as { filter?: Record<string, unknown>; }).filter,).toEqual({},);
    });

    it('sort by startsAt orders by the NEXT occurrence (a weekly series before a later one-off)', async () => {
        levelMock.mockResolvedValue(-1,);
        listMock.mockResolvedValue({
            total: 2,
            items: [
                { id: 'old-weekly', title: 'Weekly', startsAt: new Date('2026-01-05T15:00:00.000Z',), endsAt: null, allDay: false, recurrenceRule: 'weekly', recurrenceUntil: null, },
                { id: 'one-off', title: 'One-off', startsAt: new Date('2026-12-01T15:00:00.000Z',), endsAt: null, allDay: false, recurrenceRule: null, recurrenceUntil: null, },
            ].reverse(),
        },);
        repoMock.findByIds.mockImplementation(async (ids: string[],) => ids.map((id,) => ev({
            id, slug: id, recurrenceRule: id === 'old-weekly' ? 'weekly' : null,
            startsAt: id === 'old-weekly' ? '2026-01-05T15:00:00.000Z' : '2026-12-01T15:00:00.000Z', endsAt: null,
        },)),);
        const res = await eventEntityProvider.list!({ sortBy: 'startsAt', sortOrder: 'asc', limit: 10, }, {},);
        expect(res.items.map((r,) => r.id),).toEqual(['old-weekly', 'one-off',],);
    });
});

describe('eventEntityProvider.allows (single reads)', () => {
    beforeEach(() => {
        settings = { ...DEFAULT_EVENTS_SETTINGS, };
        levelMock.mockReset();
        repoMock.findById.mockReset().mockResolvedValue(ev({ viewAccess: 'members', },),);
    });

    it('anonymous may not open a members event; a member may', async () => {
        levelMock.mockResolvedValue(-1,);
        expect(await eventEntityProvider.allows!({ id: 'e1', status: 'published', }, {},),).toBe(false,);
        levelMock.mockResolvedValue(0,);
        expect(await eventEntityProvider.allows!({ id: 'e1', status: 'published', }, { viewer: { id: 'u', role: 'member', }, },),).toBe(true,);
    });

    it('a draft is never readable by non-staff', async () => {
        levelMock.mockResolvedValue(0,);
        expect(await eventEntityProvider.allows!({ id: 'e1', status: 'draft', }, {},),).toBe(false,);
    });
});
