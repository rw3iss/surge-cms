import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(async () => ({ rows: [], }),), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: {}, }),);

import { assertCanManage, } from './users';

const admin = { id: 'a1', role: 'admin', };
const sys = { id: 's1', role: 'sysadmin', };
const member = { id: 'm1', role: 'member', };
const sysTarget = { id: 's2', role: 'sysadmin', };

describe('assertCanManage — one rule set for single-user routes and bulk', () => {
    it('an admin cannot grant sysadmin (create or update, incl. themselves)', () => {
        expect(() => assertCanManage(admin, null, 'create', { role: 'sysadmin', },),).toThrow(/Only a sysadmin can grant/,);
        expect(() => assertCanManage(admin, member, 'update', { role: 'sysadmin', },),).toThrow(/Only a sysadmin can grant/,);
        expect(() => assertCanManage(admin, { id: 'a1', role: 'admin', }, 'update', { role: 'sysadmin', },),).toThrow();
    },);

    it('an admin cannot act on a sysadmin (password / ban / delete / update)', () => {
        for (const action of ['password', 'ban', 'unban', 'delete', 'update',] as const) {
            expect(() => assertCanManage(admin, sysTarget, action,),).toThrow(/Only a sysadmin can manage/,);
        }
    },);

    it('a sysadmin can, except on their own account', () => {
        expect(() => assertCanManage(sys, sysTarget, 'password',),).not.toThrow();
        expect(() => assertCanManage(sys, member, 'update', { role: 'sysadmin', },),).not.toThrow();
        expect(() => assertCanManage(sys, { id: 's1', role: 'sysadmin', }, 'delete',),).toThrow(/your own account/,);
        expect(() => assertCanManage(sys, { id: 's1', role: 'sysadmin', }, 'update', { role: 'admin', },),).toThrow(/own role/,);
    },);

    it('normal admin work on members still passes', () => {
        expect(() => assertCanManage(admin, member, 'ban',),).not.toThrow();
        expect(() => assertCanManage(admin, member, 'update', { role: 'editor', },),).not.toThrow();
        expect(() => assertCanManage(admin, { id: 'a1', role: 'admin', }, 'update', { role: 'admin', },),).not.toThrow();
        expect(() => assertCanManage(admin, { id: 'a1', role: 'admin', }, 'ban',),).toThrow(/your own/,);
    },);
},);
