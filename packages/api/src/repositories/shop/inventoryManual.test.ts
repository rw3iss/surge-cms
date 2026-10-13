import { describe, expect, it, vi, beforeEach, } from 'vitest';

// Capture the SQL + params the structure writer sends for a matched variant.
const calls: Array<{ sql: string; params: unknown[]; }> = [];
const client = {
    query: vi.fn(async (sql: string, params: unknown[] = [],) => {
        calls.push({ sql, params, },);
        if (sql.startsWith('SELECT id, external_id',)) {
            return { rows: [{ id: 'v1', external_id: 'ext-1', option1: 'Red', option2: null, option3: null, },], };
        }
        if (sql.includes('COUNT(*)',)) return { rows: [{ n: 1, },], };
        return { rows: [], };
    },),
};
vi.mock('../../db', () => ({ query: vi.fn(), transaction: (fn: (c: unknown,) => unknown,) => fn(client,), }),);

import { replaceProductStructure, } from './shopProducts.repo';

const update = () => calls.find((c,) => c.sql.includes('UPDATE shop_variants SET',))!;

describe('variant inventory: manual vs provider sync', () => {
    beforeEach(() => { calls.length = 0; },);

    it('a provider sync caps a manual inventory with LEAST and keeps the flag', async () => {
        await replaceProductStructure('p1', {
            variants: [{ priceCents: 100, inventoryQty: 9999, option1: 'Red', externalId: 'ext-1', },],
            inventorySource: 'provider',
        }, client as never,);
        const u = update();
        expect(u.sql,).toMatch(/CASE WHEN \$16::boolean AND inventory_manual\s+THEN LEAST\(inventory_qty, \$4\) ELSE \$4 END/,);
        expect(u.params[15],).toBe(true,);   // $16 fromProvider
        expect(u.params[16],).toBeNull();    // $17 manual: no opinion → keep
    },);

    it('an admin save stores the typed value and the manual flag', async () => {
        await replaceProductStructure('p1', {
            variants: [{ priceCents: 100, inventoryQty: 25, inventoryManual: true, option1: 'Red', },],
        }, client as never,);
        const u = update();
        expect(u.params[3],).toBe(25,);
        expect(u.params[15],).toBe(false,);
        expect(u.params[16],).toBe(true,);
    },);

    it('an admin save without the provider id keeps the stored external_id', async () => {
        await replaceProductStructure('p1', {
            variants: [{ priceCents: 100, option1: 'Red', },],
        }, client as never,);
        expect(update().sql,).toContain('external_id = COALESCE($14, external_id)',);
        expect(update().params[13],).toBeNull();
    },);
},);
