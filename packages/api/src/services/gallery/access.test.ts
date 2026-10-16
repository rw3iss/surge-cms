/** Gallery role / tier gate: active vs enabled-but-empty, item → collection → floor, the SQL shape. */
import { describe, expect, it, } from 'vitest';
import { ANONYMOUS_GRANTS, type ViewerGrants, } from '../access/grants';
import { cleanRule, collectionGateSql, collectionVisible, itemGateSql, itemPasses, } from './access';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const off = { enabled: false, roles: [], tierIds: [], };
const member: ViewerGrants = { signedIn: true, staff: false, roles: ['member', 'ambassador',], tierIds: [T1,], };
const staff: ViewerGrants = { signedIn: true, staff: true, roles: ['editor',], tierIds: [], };

describe('itemPasses', () => {
    it('enabled but nothing chosen is NOT active — falls through to the floor', () => {
        const empty = { enabled: true, roles: [], tierIds: [], };
        expect(itemPasses(empty, empty, ANONYMOUS_GRANTS, true,),).toBe(true,);
        expect(itemPasses(empty, null, member, false,),).toBe(false,);
    },);

    it('chosen but disabled is NOT active', () => {
        expect(itemPasses({ enabled: false, roles: ['vip',], tierIds: [], }, null, ANONYMOUS_GRANTS, true,),).toBe(true,);
    },);

    it('an active item rule replaces the floor (either way)', () => {
        expect(itemPasses({ enabled: true, roles: ['ambassador',], tierIds: [], }, null, member, false,),).toBe(true,);
        expect(itemPasses({ enabled: true, roles: ['vip',], tierIds: [], }, null, member, true,),).toBe(false,);
        expect(itemPasses({ enabled: true, roles: [], tierIds: [T1,], }, null, member, false,),).toBe(true,);
    },);

    it('item rule wins over the collection rule; collection rule applies when the item has none', () => {
        const coll = { enabled: true, roles: ['vip',], tierIds: [], };
        expect(itemPasses({ enabled: true, roles: [], tierIds: [T1,], }, coll, member, false,),).toBe(true,);
        expect(itemPasses(off, coll, member, true,),).toBe(false,);
        expect(itemPasses(off, { enabled: true, roles: [], tierIds: [T1, T2,], }, member, false,),).toBe(true,);
    },);

    it('anonymous never passes an active rule; staff always pass', () => {
        const rule = { enabled: true, roles: ['member',], tierIds: [T1,], };
        expect(itemPasses(rule, null, ANONYMOUS_GRANTS, true,),).toBe(false,);
        expect(itemPasses(rule, null, staff, false,),).toBe(true,);
    },);
},);

describe('collectionVisible', () => {
    it('inactive → visible; active → only when passed', () => {
        expect(collectionVisible({ enabled: true, roles: [], tierIds: [], }, ANONYMOUS_GRANTS,),).toBe(true,);
        expect(collectionVisible({ enabled: true, roles: ['vip',], tierIds: [], }, member,),).toBe(false,);
        expect(collectionVisible({ enabled: true, roles: ['vip',], tierIds: [T1,], }, member,),).toBe(true,);
    },);
},);

describe('SQL predicates', () => {
    it('item gate: item rule → collection rule → floor, roles/tiers bound', () => {
        const params: unknown[] = [];
        const sql = itemGateSql(member, 'FLOOR', params,);
        expect(params,).toEqual([member.roles, member.tierIds,],);
        expect(sql,).toMatch(/CASE WHEN \(gi\.access_enabled AND \(cardinality\(gi\.access_roles\) > 0 OR cardinality\(gi\.access_tier_ids\) > 0\)\)/,);
        expect(sql,).toContain('gi.access_roles && $1::text[] OR gi.access_tier_ids && $2::uuid[]',);
        expect(sql,).toContain('WHEN gc.id IS NOT NULL AND (gc.access_enabled',);
        expect(sql,).toContain('ELSE FLOOR END',);
        expect(sql.indexOf('gi.access_enabled',),).toBeLessThan(sql.indexOf('gc.access_enabled',),);
    },);

    it('staff: no gate, nothing bound', () => {
        const params: unknown[] = [];
        expect(itemGateSql(staff, 'FLOOR', params,),).toBe('TRUE',);
        expect(collectionGateSql(staff, params,),).toBe('TRUE',);
        expect(params,).toEqual([],);
    },);

    it('collection gate: inactive OR passed', () => {
        const params: unknown[] = ['x',];
        expect(collectionGateSql(ANONYMOUS_GRANTS, params,),).toBe(
            '(NOT (gc.access_enabled AND (cardinality(gc.access_roles) > 0 OR cardinality(gc.access_tier_ids) > 0)) OR (gc.access_roles && $2::text[] OR gc.access_tier_ids && $3::uuid[]))',
        );
    },);
},);

describe('cleanRule', () => {
    it('dedupes and validates', () => {
        expect(cleanRule({ enabled: true, roles: ['vip', ' vip ',], tierIds: [T1, T1,], },),).toEqual({ enabled: true, roles: ['vip',], tierIds: [T1,], },);
        expect(() => cleanRule({ enabled: true, roles: ['bad role;',], tierIds: [], },),).toThrow(/Unknown role/,);
        expect(() => cleanRule({ enabled: true, roles: [], tierIds: ['nope',], },),).toThrow(/tier ids/,);
        expect(cleanRule(undefined,),).toEqual(off,);
    },);
},);
