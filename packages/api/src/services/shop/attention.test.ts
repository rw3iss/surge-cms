import { describe, expect, it, vi, } from 'vitest';

const query = vi.fn(async () => ({ rows: [{ total: 4, not_sent: 2, on_hold: 1, stalled: 0, cancelled: 1, },], }));
vi.mock('../../db', () => ({ query: (...a: unknown[]) => (query as (...x: unknown[]) => unknown)(...a), }),);

const { attentionCounts, attentionReasonSql, attentionWhereSql, } = await import('./attention');

describe('needs-attention definition', () => {
    it('counts a supplier-cancelled order on a still-paid order', () => {
        expect(attentionReasonSql(1,).cancelled,).toContain(`f.status = 'cancelled'`,);
        expect(attentionWhereSql(1,),).toContain(`o.status IN ('paid', 'processing')`,);
        expect(attentionWhereSql(1,),).toContain(`f.status = 'cancelled'`,);
    },);

    it('uses the placeholder it is given (so a list query can append it)', () => {
        const sql = attentionWhereSql(7,);
        expect(sql,).toContain('$7::text IS NULL',);
        expect(sql,).not.toContain('$1',);
    },);

    it('maps the per-reason counts', async () => {
        await expect(attentionCounts('printify',),).resolves.toEqual({ total: 4, notSent: 2, onHold: 1, stalled: 0, cancelled: 1, },);
        expect((query.mock.calls[0] as unknown[])[1],).toEqual(['printify',],);
    },);
},);
