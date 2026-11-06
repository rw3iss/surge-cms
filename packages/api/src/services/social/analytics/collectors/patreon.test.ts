import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0, })), }),);
vi.mock('../../../../config', () => ({ config: { patreon: { clientId: '', clientSecret: '', campaignId: '', creatorAccessToken: '', }, }, }),);

import { getCollector, } from '../registry';
import { newerSavedToken, patreonAccount, patreonDaily, summarizeMembers, } from './patreon';

const members = [
    { patron_status: 'active_patron' as const, currently_entitled_amount_cents: 500, campaign_lifetime_support_cents: 3000, pledge_relationship_start: '2026-11-04T10:00:00.000+00:00', },
    { patron_status: 'active_patron' as const, currently_entitled_amount_cents: 1000, is_free_trial: true, pledge_relationship_start: '2026-11-04T23:00:00Z', },
    { patron_status: 'active_patron' as const, currently_entitled_amount_cents: 0, pledge_relationship_start: '2025-01-01T00:00:00Z', },
    { patron_status: 'declined_patron' as const, currently_entitled_amount_cents: 500, },
    { patron_status: 'former_patron' as const, campaign_lifetime_support_cents: 700, },
    { patron_status: null, pledge_relationship_start: '2026-11-03T00:00:00Z', },
];

describe('patreon mappers', () => {
    it('summarizes members', () => {
        const s = summarizeMembers(members,);
        expect(s,).toMatchObject({
            activePatrons: 3, paidMembers: 1, declinedPatrons: 1, formerPatrons: 1, freeMembers: 1,
            monthlyIncomeCents: 500, lifetimeSupportCents: 3700,
        },);
        expect(s.newByDay,).toEqual({ '2026-11-04': 2, '2025-01-01': 1, },);
    },);
    it('uses a token another process renewed instead of the stale rotated one', () => {
        const now = Date.parse('2026-11-05T00:00:00Z',);
        const creds: Record<string, unknown> = { accessToken: 'a1', refreshToken: 'r1', };
        expect(newerSavedToken(creds, { accessToken: 'a1', }, now,),).toBeNull();
        expect(newerSavedToken(creds, { accessToken: 'a2', tokenExpiresAt: '2026-11-01T00:00:00Z', }, now,),).toBeNull();
        expect(newerSavedToken(creds, { accessToken: 'a2', refreshToken: 'r2', tokenExpiresAt: '2026-12-01T00:00:00Z', }, now,),).toBe('a2',);
        expect(creds,).toMatchObject({ accessToken: 'a2', refreshToken: 'r2', },);
    },);
    it('builds the account snapshot and daily points', () => {
        const s = summarizeMembers(members,);
        const a = patreonAccount({ patron_count: 42, currency: 'USD', }, s, 'c1',);
        expect(a.followers,).toBe(42,);
        expect(a.raw,).toMatchObject({ campaignId: 'c1', monthlyIncomeCents: 500, paidMembers: 1, },);
        expect(patreonAccount({}, s, 'c1',).followers,).toBe(3,);
        const d = patreonDaily('2026-11-05', { patron_count: 42, }, s,);
        expect(d,).toContainEqual({ date: '2026-11-05', metric: 'patrons', value: 42, },);
        expect(d,).toContainEqual({ date: '2026-11-05', metric: 'monthlyIncomeCents', value: 500, },);
        expect(d,).toContainEqual({ date: '2026-11-04', metric: 'newPatrons', value: 2, },);
        expect(d,).toContainEqual({ date: '2026-10-29', metric: 'newPatrons', value: 0, },);
        expect(d.filter((p,) => p.metric === 'newPatrons'),).toHaveLength(8,);
        expect(patreonDaily('2026-11-05', {}, null,),).toEqual([],);
    },);
},);

describe('patreon collector', () => {
    const c = getCollector('patreon',)!;
    it('status', async () => {
        expect((await c.status({}, true,)).state,).toBe('off',);
        expect((await c.status({ accessToken: 't', scope: 'identity campaigns', }, true,)).state,).toBe('partial',);
        const ready = await c.status({ accessToken: 't', }, true,);
        expect(ready.state,).toBe('ready',);
        expect(ready.collects.join(),).toMatch(/post analytics/,);
    },);
    it('collects campaign + paged members; warns when members are forbidden', async () => {
        let page = 0;
        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) => {
            const u = String(url,);
            const json = (b: unknown, status = 200,) => new Response(JSON.stringify(b,), { status, },);
            if (u.includes('/members',)) {
                page++;
                return page === 1
                    ? json({ data: [{ attributes: members[0], },], meta: { pagination: { cursors: { next: 'abc', }, }, }, },)
                    : json({ data: [{ attributes: members[3], },], meta: { pagination: { cursors: { next: null, }, }, }, },);
            }
            if (u.includes('/campaigns',)) return json({ data: [{ id: 'c9', attributes: { patron_count: 2, }, },], },);
            return json({}, 404,);
        },);
        const res = await c.collect({ today: '2026-11-05', posts: [], credentials: { accessToken: 't', }, settings: {}, warn: () => {}, },);
        expect(page,).toBe(2,);
        expect(res.account?.raw,).toMatchObject({ campaignId: 'c9', activePatrons: 1, declinedPatrons: 1, },);

        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) =>
            String(url,).includes('/members',)
                ? new Response(JSON.stringify({ errors: [{ detail: 'forbidden', },], },), { status: 403, },)
                : new Response(JSON.stringify({ data: [{ id: 'c9', attributes: { patron_count: 2, }, },], },), { status: 200, },)
        );
        const warnings: string[] = [];
        const r2 = await c.collect({ today: '2026-11-05', posts: [], credentials: { accessToken: 't', }, settings: {}, warn: (m,) => warnings.push(m,), },);
        expect(r2.account?.followers,).toBe(2,);
        expect(warnings[0],).toMatch(/campaigns.members/,);
    },);
},);
