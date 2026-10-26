import { describe, expect, it, } from 'vitest';
import { loginRouteFor, normalizeLoginRoute, type LoginRouteRole, } from './loginRoute';

const roles: LoginRouteRole[] = [
    { key: 'member', baseRole: null, loginRoute: '', loginPriority: 0, },
    { key: 'subscriber', baseRole: 'member', loginRoute: null, loginPriority: 0, },
    { key: 'admin', baseRole: null, loginRoute: 'admin', loginPriority: 100, },
    { key: 'contributor', baseRole: 'member', loginRoute: 'admin', loginPriority: 50, },
    { key: 'affiliate', baseRole: 'member', loginRoute: 'profile?tab=affiliate', loginPriority: 40, },
    { key: 'fan', baseRole: 'subscriber', loginRoute: null, loginPriority: 0, },
];

describe('loginRouteFor', () => {
    it('defaults to the homepage', () => expect(loginRouteFor(roles, 'member',),).toBe('',),);
    it('inherits from the base role', () => expect(loginRouteFor(roles, 'fan',),).toBe('',),);
    it('uses an additional role with a higher priority', () => {
        expect(loginRouteFor(roles, 'subscriber', ['contributor',],),).toBe('admin',);
        expect(loginRouteFor(roles, 'member', ['affiliate', 'contributor',],),).toBe('admin',);
        expect(loginRouteFor(roles, 'member', ['affiliate',],),).toBe('profile?tab=affiliate',);
    },);
    it('admins land in the admin', () => expect(loginRouteFor(roles, 'admin', ['affiliate',],),).toBe('admin',),);
    it('unknown roles fall back to the homepage', () => expect(loginRouteFor(roles, 'ghost',),).toBe('',),);
},);

describe('normalizeLoginRoute', () => {
    it('strips leading slashes and spaces', () => expect(normalizeLoginRoute('  /admin/posts ',),).toBe('admin/posts',),);
    it('keeps empty = homepage and null = inherit', () => {
        expect(normalizeLoginRoute('',),).toBe('',);
        expect(normalizeLoginRoute(null,),).toBeNull();
    },);
    it('refuses external / script targets', () => {
        expect(normalizeLoginRoute('https://evil.com',),).toBeNull();
        expect(normalizeLoginRoute('javascript:alert(1)',),).toBeNull();
        expect(normalizeLoginRoute('//evil.com',),).toBe('evil.com',);
    },);
},);
