/**
 * The member's PARTNER PROGRAM page (affiliates + contributors) —
 * `/api/v1/partners`. One Stripe Connect Express account per partner, shared
 * by the programs; each program's earnings are paid separately.
 * Permission `partners:self` + membership in a program. Services:
 * services/partners (Stripe), services/contributions (`partnerMe`).
 */
import { defineRoute, } from '../api/defineRoute';
import { ForbiddenError, } from '../core/errors';
import * as contributions from '../services/contributions';
import * as partners from '../services/partners/stripeConnect';
import * as permissions from '../services/permissions';
import { isFeatureEnabledServer, } from '../services/settings';

type Caller = { id?: string; role?: string; email?: string; } | undefined;

async function programs(user: { id: string; role?: string; },): Promise<{ affiliate: boolean; contributor: boolean; }> {
    const affiliate = await isFeatureEnabledServer('affiliates',)
        ? await import('../services/affiliates/index.js').then((m,) => m.isAffiliate(user.id,),).catch(() => false)
        : false;
    return { affiliate, contributor: await contributions.isContributor(user,), };
}

async function self(user: Caller,): Promise<{ id: string; role?: string; affiliate: boolean; }> {
    if (!user?.id) throw new ForbiddenError('Sign in first.',);
    await permissions.requirePermission({ id: user.id, role: user.role, }, 'partners:self',);
    const p = await programs({ id: user.id, role: user.role, },);
    if (!p.affiliate && !p.contributor) throw new ForbiddenError('You are not part of a partner program.',);
    return { id: user.id, role: user.role, affiliate: p.affiliate, };
}

export const partnerRoutes = [
    defineRoute({
        method: 'get', path: '/me/status', auth: 'user',
        summary: 'Which partner programs the caller is in (shows Profile → Partner Program).',
        handler: async ({ user, },) => (user ? programs({ id: user.id, role: user.role, },) : { affiliate: false, contributor: false, }),
    },),
    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'The Partner Program page: programs, Stripe account, totals, and the contributions (with payouts).',
        handler: async ({ user, },) => { const s = await self(user,); return contributions.partnerMe(s, s.affiliate,); },
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/onboard', auth: 'user',
        summary: 'Connect (or finish connecting) your Stripe Express account — returns the Stripe onboarding link.',
        handler: async ({ user, },) => ({ url: await partners.onboardingLink((await self(user,)).id, user?.email ?? null,), }),
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/dashboard', auth: 'user',
        summary: 'A one-time link into your Stripe Express dashboard (payouts, bank details).',
        handler: async ({ user, },) => ({ url: await partners.dashboardLink((await self(user,)).id,), }),
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/refresh', auth: 'user',
        summary: 'Re-read your Stripe account status (after onboarding).',
        handler: async ({ user, },) => partners.refreshStatus((await self(user,)).id,),
    },),
];
