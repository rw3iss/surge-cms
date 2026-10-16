import { describe, expect, it, vi, } from 'vitest';
import { deniedReasonOf, handleAccessDenied, } from './accessDenied';

const err = (code: string, details: Record<string, unknown> = {},) => ({ code, details, message: 'x', });

describe('deniedReasonOf', () => {
    it('maps a sign-in gate for a signed-out visitor to signin', () => {
        expect(deniedReasonOf(err('SIGN_IN_REQUIRED', { reason: 'signin', },), false,),).toEqual({ reason: 'signin', tierName: null, },);
    },);
    it('never asks a signed-in visitor to sign in', () => {
        expect(deniedReasonOf(err('SIGN_IN_REQUIRED', { reason: 'signin', },), true,),).toEqual({ reason: 'forbidden', tierName: null, },);
    },);
    it('names the tier when the API does', () => {
        const e = err('SUBSCRIPTION_REQUIRED', { reason: 'subscribe', requiredTier: { id: 't', name: 'Gold', }, },);
        expect(deniedReasonOf(e, true,),).toEqual({ reason: 'tier', tierName: 'Gold', },);
    },);
    it('ignores other failures (404 stays a 404)', () => {
        expect(deniedReasonOf(err('NOT_FOUND',), false,),).toBeNull();
        expect(deniedReasonOf(new Error('boom',), false,),).toBeNull();
    },);
},);

describe('handleAccessDenied', () => {
    it('replaces the entry with the login URL', () => {
        const nav = vi.fn();
        handleAccessDenied(nav, 'forbidden', { returnTo: '/gallery/abc', },);
        expect(nav,).toHaveBeenCalledWith('/login?redirect=%2Fgallery%2Fabc&reason=forbidden', { replace: true, },);
    },);
},);
