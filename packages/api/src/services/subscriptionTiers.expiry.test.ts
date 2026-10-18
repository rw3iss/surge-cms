import { describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), transaction: vi.fn(), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);

const { expireManualSubscriptions, } = await import('./subscriptionTiers');

describe('expireManualSubscriptions (C11)', () => {
    it('ends only hand-assigned rows past their end date, then syncs each role once', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('current_period_end <= NOW()',)
            ? { rows: [{ user_id: 'u1', }, { user_id: 'u1', }, { user_id: 'u2', },], }
            : { rows: [], },);
        const n = await expireManualSubscriptions();
        expect(n,).toBe(3,);
        const sql = String(q.mock.calls[0][0],);
        expect(sql,).toContain('stripe_subscription_id IS NULL',);
        expect(sql,).toContain('current_period_end <= NOW()',);
    },);
},);
