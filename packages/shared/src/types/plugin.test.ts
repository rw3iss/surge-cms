import { describe, expect, it, } from 'vitest';
import { pluginRoleList, pluginVisibleTo, } from './plugin';

describe('pluginVisibleTo', () => {
    const p = (visibleRoles: string[], adminOnly = false,) => ({ visibleRoles, adminOnly, });
    it('no roles = everyone, signed in or not', () => {
        expect(pluginVisibleTo(p([],), null,),).toBe(true,);
        expect(pluginVisibleTo(p([],), { role: 'member', },),).toBe(true,);
    },);
    it('roles: main OR extra role must match; anonymous never', () => {
        const pl = p(['sysadmin', 'developer',],);
        expect(pluginVisibleTo(pl, null,),).toBe(false,);
        expect(pluginVisibleTo(pl, { role: 'admin', },),).toBe(false,);
        expect(pluginVisibleTo(pl, { role: 'sysadmin', },),).toBe(true,);
        expect(pluginVisibleTo(pl, { role: 'member', extraRoles: ['developer',], },),).toBe(true,);
    },);
    it('legacy adminOnly = admin + sysadmin; roles win when set', () => {
        expect(pluginVisibleTo(p([], true,), { role: 'admin', },),).toBe(true,);
        expect(pluginVisibleTo(p([], true,), { role: 'editor', },),).toBe(false,);
        expect(pluginVisibleTo(p(['editor',], true,), { role: 'editor', },),).toBe(true,);
    },);
    it('pluginRoleList cleans a config value', () => {
        expect(pluginRoleList([' admin', 'admin', 3, '', 'developer',],),).toEqual(['admin', 'developer',],);
        expect(pluginRoleList('admin',),).toEqual([],);
    },);
},);
