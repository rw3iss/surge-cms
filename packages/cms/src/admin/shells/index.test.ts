import { describe, expect, it, } from 'vitest';
import { adminShellFor, canEnterAdmin, ROLE_SHELLS, shellAllowsPath, } from '.';

describe('adminShellFor / canEnterAdmin', () => {
    it('staff get the full admin (no shell)', () => {
        expect(adminShellFor({ role: 'editor', extraRoles: ['contributor',], },),).toBeNull();
        expect(canEnterAdmin({ role: 'admin', extraRoles: [], },),).toBe(true,);
    },);
    it('a contributor (main or additional role) gets the contributor shell', () => {
        expect(adminShellFor({ role: 'contributor', extraRoles: [], },),).toBe(ROLE_SHELLS.contributor,);
        expect(adminShellFor({ role: 'member', extraRoles: ['affiliate', 'contributor',], },),).toBe(ROLE_SHELLS.contributor,);
    },);
    it('other members cannot enter', () => {
        expect(canEnterAdmin({ role: 'member', extraRoles: ['affiliate',], },),).toBe(false,);
        expect(canEnterAdmin(null,),).toBe(false,);
    },);
},);

describe('shellAllowsPath (contributor)', () => {
    const sh = ROLE_SHELLS.contributor;
    it('opens the dashboard, own posts, help and notifications', () => {
        for (const p of ['/admin', '/admin/', '/admin/posts', '/admin/posts/new', '/admin/posts/abc?x=1', '/admin/help/sdk', '/admin/notifications',]) {
            expect(shellAllowsPath(sh, p,), p,).toBe(true,);
        }
    },);
    it('keeps staff pages closed', () => {
        for (const p of ['/admin/posts/settings', '/admin/posts/settings/', '/admin/pages', '/admin/users', '/admin/settings', '/admin/postsx', '/admin/media',]) {
            expect(shellAllowsPath(sh, p,), p,).toBe(false,);
        }
    },);
    it('defaults to the nav paths when a shell names none', () => {
        expect(shellAllowsPath({ nav: ['media',], }, '/admin/media/x', ['/admin/media',],),).toBe(true,);
        expect(shellAllowsPath({ nav: ['media',], }, '/admin/posts', ['/admin/media',],),).toBe(false,);
    },);
},);
