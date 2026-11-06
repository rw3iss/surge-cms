import { describe, expect, it, } from 'vitest';
import { loginRoutePath, returnPathFrom, } from './loginTarget';

describe('returnPathFrom', () => {
    it('keeps a site path and normalizes a bare name', () => {
        expect(returnPathFrom('/posts/a?x=1',),).toBe('/posts/a?x=1',);
        expect(returnPathFrom('profile',),).toBe('/profile',);
    },);
    it('refuses external, protocol-relative and backslash targets', () => {
        expect(returnPathFrom('https://evil.example',),).toBe('',);
        expect(returnPathFrom('//evil.example',),).toBe('',);
        expect(returnPathFrom('/\\evil.example',),).toBe('',);
        expect(returnPathFrom('javascript:alert(1)',),).toBe('',);
    },);
    it('refuses the login page itself', () => {
        expect(returnPathFrom('/login?redirect=/x',),).toBe('',);
        expect(returnPathFrom('/login',),).toBe('',);
        expect(returnPathFrom('/loginhelp',),).toBe('/loginhelp',);
    },);
    it('takes the first given value (redirect before return)', () => {
        expect(returnPathFrom(undefined, '/b',),).toBe('/b',);
        expect(returnPathFrom('/a', '/b',),).toBe('/a',);
    },);
});

describe('loginRoutePath', () => {
    it('is null when unset and / for the homepage', () => {
        expect(loginRoutePath(null,),).toBeNull();
        expect(loginRoutePath('',),).toBe('/',);
    },);
    it('prefixes one slash and never makes //host', () => {
        expect(loginRoutePath('admin',),).toBe('/admin',);
        expect(loginRoutePath('/admin',),).toBe('/admin',);
        expect(loginRoutePath('//evil.example',),).toBe('/evil.example',);
        expect(loginRoutePath('profile?tab=affiliate',),).toBe('/profile?tab=affiliate',);
    },);
    it('falls back to the homepage for unsafe routes', () => {
        expect(loginRoutePath('https://evil.example',),).toBe('/https://evil.example',);
        expect(loginRoutePath('a\\b',),).toBe('/',);
        expect(loginRoutePath('login',),).toBe('/',);
    },);
});
