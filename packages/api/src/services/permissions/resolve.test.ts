import { describe, expect, it, } from 'vitest';
import type { PermissionDefinition, PermissionGrant, } from '@sitesurge/types';
import { resolveMany, resolvePermission, } from './resolve';

/**
 * These tests ARE the authorisation policy. Every case below is one a real
 * deployment can hit, and the fail-closed ones matter most: a permission system
 * that errs open is worse than none, because it looks like it is protecting
 * something.
 */

function perm(over: Partial<PermissionDefinition> = {},): PermissionDefinition {
    return {
        key: 'posts:write',
        feature: 'posts',
        label: 'Create and edit posts',
        defaultAccess: 'roles',
        defaultRoles: ['editor', 'admin', 'sysadmin',],
        isSystem: true,
        ...over,
    };
}

function grant(over: Partial<PermissionGrant> = {},): PermissionGrant {
    return {
        id: 'g1',
        permissionKey: 'posts:write',
        subjectType: 'user',
        subjectId: 'u1',
        granted: true,
        ...over,
    };
}

describe('defaults', () => {
    it('everyone → allowed even for an anonymous visitor', () => {
        const r = resolvePermission(perm({ defaultAccess: 'everyone', },), { role: 'anonymous', },);
        expect(r.allowed,).toBe(true,);
        expect(r.reason,).toBe('default-everyone',);
    },);

    it('roles → allowed only for a listed role', () => {
        expect(resolvePermission(perm(), { id: 'u1', role: 'editor', },).allowed,).toBe(true,);
        expect(resolvePermission(perm(), { id: 'u2', role: 'member', },).allowed,).toBe(false,);
    },);

    it('nobody → denied with no grant', () => {
        const r = resolvePermission(perm({ defaultAccess: 'nobody', },), { id: 'u1', role: 'admin', },);
        expect(r.allowed,).toBe(false,);
        expect(r.reason,).toBe('default-nobody',);
    },);

    it('nobody still yields to an explicit grant', () => {
        // "nobody" means "no one UNLESS named", not "no one ever" — otherwise
        // it would be impossible to model a permission only two people hold.
        const r = resolvePermission(
            perm({ defaultAccess: 'nobody', },),
            { id: 'u1', role: 'member', },
            [grant(),],
        );
        expect(r.allowed,).toBe(true,);
    },);
},);

describe('precedence', () => {
    it('a user DENY overrides the role default that allows', () => {
        const r = resolvePermission(
            perm(),
            { id: 'u1', role: 'editor', },
            [grant({ granted: false, },),],
        );
        expect(r.allowed,).toBe(false,);
        expect(r.reason,).toBe('user-deny',);
    },);

    it('a user ALLOW overrides a role deny', () => {
        const r = resolvePermission(
            perm(),
            { id: 'u1', role: 'member', },
            [
                grant({ subjectType: 'role', subjectId: 'member', granted: false, id: 'g2', },),
                grant({ granted: true, },),
            ],
        );
        expect(r.allowed,).toBe(true,);
        expect(r.reason,).toBe('user-grant',);
    },);

    it('a role grant lifts a user whose role is not in the default list', () => {
        const r = resolvePermission(
            perm(),
            { id: 'u9', role: 'member', },
            [grant({ subjectType: 'role', subjectId: 'member', granted: true, },),],
        );
        expect(r.allowed,).toBe(true,);
        expect(r.reason,).toBe('role-grant',);
    },);

    it('a role DENY overrides a default that allows', () => {
        const r = resolvePermission(
            perm(),
            { id: 'u9', role: 'editor', },
            [grant({ subjectType: 'role', subjectId: 'editor', granted: false, },),],
        );
        expect(r.allowed,).toBe(false,);
        expect(r.reason,).toBe('role-deny',);
    },);

    it('another user\'s grant does not leak', () => {
        const r = resolvePermission(
            perm({ defaultAccess: 'nobody', },),
            { id: 'someone-else', role: 'member', },
            [grant({ subjectId: 'u1', },),],
        );
        expect(r.allowed,).toBe(false,);
    },);

    it('a grant for another permission does not apply', () => {
        // resolvePermission trusts its caller to pass the right grants, so this
        // pins that resolveMany's bucketing is what does the filtering.
        const out = resolveMany(
            [perm(), perm({ key: 'posts:delete', defaultAccess: 'nobody', },),],
            { id: 'u1', role: 'member', },
            [grant({ permissionKey: 'posts:write', },),],
        );
        expect(out['posts:write'],).toBe(true,);
        expect(out['posts:delete'],).toBe(false,);
    },);
},);

describe('sysadmin bypass', () => {
    it('is allowed even when the default is nobody', () => {
        const r = resolvePermission(perm({ defaultAccess: 'nobody', },), { id: 's', role: 'sysadmin', },);
        expect(r.allowed,).toBe(true,);
        expect(r.reason,).toBe('sysadmin-bypass',);
    },);

    it('survives an explicit user DENY', () => {
        // Otherwise an admin could revoke the sysadmin's own access to the
        // permissions screen and leave the site unadministrable.
        const r = resolvePermission(
            perm(),
            { id: 's', role: 'sysadmin', },
            [grant({ subjectId: 's', granted: false, },),],
        );
        expect(r.allowed,).toBe(true,);
    },);

    it('applies to an unknown permission too', () => {
        expect(resolvePermission(undefined, { role: 'sysadmin', },).allowed,).toBe(true,);
    },);
},);

describe('fails closed', () => {
    it('denies an unknown permission key', () => {
        // A typo in a guard must not grant access.
        const r = resolvePermission(undefined, { id: 'u1', role: 'admin', },);
        expect(r.allowed,).toBe(false,);
        expect(r.reason,).toBe('unknown-permission',);
    },);

    it('denies a subject with no role when the default is role-based', () => {
        expect(resolvePermission(perm(), {},).allowed,).toBe(false,);
    },);

    it('ignores a user grant when the subject has no id', () => {
        // An anonymous caller must not match a grant row by accident.
        const r = resolvePermission(perm({ defaultAccess: 'nobody', },), { role: 'member', }, [grant(),],);
        expect(r.allowed,).toBe(false,);
    },);

    it('treats an unrecognised defaultAccess as denied', () => {
        const r = resolvePermission(
            perm({ defaultAccess: 'sideways' as never, },),
            { id: 'u1', role: 'admin', },
        );
        expect(r.allowed,).toBe(false,);
    },);
},);

describe('resolveMany', () => {
    it('answers every permission for one subject', () => {
        const out = resolveMany(
            [
                perm({ key: 'posts:read', defaultAccess: 'everyone', },),
                perm({ key: 'posts:write', },),
                perm({ key: 'posts:delete', defaultRoles: ['admin',], },),
            ],
            { id: 'u1', role: 'editor', },
        );
        expect(out,).toEqual({
            'posts:read': true,
            'posts:write': true,
            'posts:delete': false,
        },);
    },);
},);
