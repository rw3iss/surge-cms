import { describe, expect, it, } from 'vitest';
import { deniedMessage, loginUrlForDenied, parseDeniedReason, safeReturnPath, } from './accessDenied';

describe('loginUrlForDenied', () => {
    it('builds the login URL with redirect + reason', () => {
        expect(loginUrlForDenied('/watch/abc', 'signin',),).toBe('/login?redirect=%2Fwatch%2Fabc&reason=signin',);
        expect(loginUrlForDenied('/gallery/x?y=1', 'forbidden',),).toBe('/login?redirect=%2Fgallery%2Fx%3Fy%3D1&reason=forbidden',);
    },);
    it('carries the tier name, and falls back to forbidden without one', () => {
        expect(loginUrlForDenied('/a', 'tier', 'Gold',),).toBe('/login?redirect=%2Fa&reason=tier&tier=Gold',);
        expect(loginUrlForDenied('/a', 'tier',),).toBe('/login?redirect=%2Fa&reason=forbidden',);
    },);
    it('drops external, protocol-relative and login return paths', () => {
        expect(loginUrlForDenied('//evil.com', 'signin',),).toBe('/login?reason=signin',);
        expect(loginUrlForDenied('https://evil.com', 'signin',),).toBe('/login?reason=signin',);
        expect(loginUrlForDenied('/login?redirect=/x', 'signin',),).toBe('/login?reason=signin',);
    },);
},);

describe('helpers', () => {
    it('safeReturnPath normalises bare names', () => {
        expect(safeReturnPath('profile',),).toBe('/profile',);
        expect(safeReturnPath('javascript:alert(1)',),).toBe('',);
        expect(safeReturnPath('/\\evil.com',),).toBe('',);
    },);
    it('parseDeniedReason accepts known codes only', () => {
        expect(parseDeniedReason('signin',),).toBe('signin',);
        expect(parseDeniedReason('nope',),).toBeNull();
        expect(parseDeniedReason(undefined,),).toBeNull();
    },);
    it('deniedMessage', () => {
        expect(deniedMessage('signin',),).toBe('This resource requires an account.',);
        expect(deniedMessage('tier', 'Gold',),).toBe('This resource requires the Gold membership.',);
        expect(deniedMessage('forbidden',),).toMatch(/appropriate permissions/,);
    },);
},);
