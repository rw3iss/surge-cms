import { describe, expect, it, } from 'vitest';
import { accessErrorOf, tierRequirement, upgradeHref, } from './accessRequired';

describe('accessErrorOf', () => {
    it('reads a subscription gate', () => {
        const err = Object.assign(new Error('Needs Gold',), { code: 'SUBSCRIPTION_REQUIRED', details: { reason: 'subscribe', requiredTier: { id: 't1', name: 'Gold', }, }, },);
        expect(accessErrorOf(err,),).toEqual({ reason: 'subscribe', requiredTier: { id: 't1', name: 'Gold', }, message: 'Needs Gold', },);
    },);
    it('reads a sign-in gate without details', () => {
        expect(accessErrorOf({ code: 'SIGN_IN_REQUIRED', message: 'Sign in', },),).toEqual({ reason: 'signin', requiredTier: null, message: 'Sign in', },);
    },);
    it('ignores other errors', () => {
        expect(accessErrorOf(new Error('boom',),),).toBeNull();
        expect(accessErrorOf({ code: 'FORBIDDEN', },),).toBeNull();
        expect(accessErrorOf(null,),).toBeNull();
    },);
},);

describe('upgradeHref / tierRequirement', () => {
    it('signed out → plans; signed in → membership tab with the tier', () => {
        expect(upgradeHref({ id: 't1', }, false,),).toBe('/subscribe',);
        expect(upgradeHref({ id: 't1', }, true,),).toBe('/profile?tab=membership&tier=t1',);
        expect(upgradeHref(null, true,),).toBe('/profile?tab=membership',);
    },);
    it('names the audience', () => {
        expect(tierRequirement({ name: 'Gold', },),).toBe('the Gold membership or higher',);
        expect(tierRequirement(null,),).toBe('a membership',);
    },);
},);
