import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
const settings: Record<string, unknown> = { requireSubscription: true, requireEmailVerification: false, minimumTierId: null, accessRoles: [], };
vi.mock('./settings', () => ({ getUsersSettings: vi.fn(async () => settings,), }),);
vi.mock('./membership/state', () => ({
    approvedOfferFor: vi.fn(async () => null,), pendingApplicationFor: vi.fn(async () => null,), lastFailedAttempt: vi.fn(async () => null,),
}),);
vi.mock('./permissions/index.js', () => ({ extraRoles: vi.fn(async () => ['ambassador',],), }),);

import { accessState, hasQualifyingSubscription, } from './subscriptionAccess';

beforeEach(() => {
    q.mockReset();
    settings.accessRoles = [];
},);

describe('hasQualifyingSubscription', () => {
    it('a Dev only level qualifies whatever its rank (C4)', async () => {
        q.mockResolvedValue({ rows: [{},], },);
        await hasQualifyingSubscription('u1', 3,);
        expect(String(q.mock.calls[0][0],),).toContain('p.dev_only = true',);
    },);
},);

describe('accessState', () => {
    it('restricts a member without a qualifying subscription', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('MIN(sort_order)',) ? { rows: [{ rank: 1, },], }
            : sql.includes('FROM users u',) ? { rows: [{ email_verified: true, ever: false, },], } : { rows: [], },);
        const s = await accessState({ id: 'u1', role: 'member', },);
        expect(s.restricted,).toBe(true,);
        expect(s.reason,).toBe('subscription',);
        expect(s.lapsed,).toBe(false,);
    },);

    it('lets staff and sign-in roles through', async () => {
        q.mockResolvedValue({ rows: [{ rank: 1, },], },);
        expect((await accessState({ id: 'u1', role: 'admin', },)).restricted,).toBe(false,);
        settings.accessRoles = ['ambassador',];
        const s = await accessState({ id: 'u2', role: 'member', },);
        expect(s.viaRole,).toBe(true,);
        expect(s.restricted,).toBe(false,);
    },);

    it('reports a lapsed membership only when one was paid before', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('MIN(sort_order)',) ? { rows: [{ rank: 1, },], }
            : sql.includes('FROM users u',) ? { rows: [{ email_verified: true, ever: true, },], } : { rows: [], },);
        expect((await accessState({ id: 'u1', role: 'member', },)).lapsed,).toBe(true,);
    },);
},);
