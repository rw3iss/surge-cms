/**
 * Stripe Connect EXPRESS accounts for PARTNERS (affiliates, contributors), on
 * the SHOP's Stripe account (falling back to the site default)
 * (the platform — Settings → Shop → Payment credentials; Connect must be
 * enabled there). Onboarding and the Express dashboard are Stripe-hosted
 * links; status comes from `accounts.retrieve` (on return, "Refresh") and the
 * `account.updated` webhook.
 */
import type { AffiliateStripeStatus, } from '@sitesurge/types';
import type Stripe from 'stripe';
import { config, } from '../../config';
import { AppError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getStripeClient, } from '../payment/stripe';

interface AccountRow { user_id: string; stripe_account_id: string | null; details_submitted: boolean; payouts_enabled: boolean; }

export function stripeForAffiliates(): Stripe {
    const s = getStripeClient('shop',) ?? getStripeClient('default',);
    if (!s) throw new ValidationError('Stripe is not connected yet (Settings → Payments).',);
    return s;
}
/** The platform Stripe client partner payouts use (shop account, else the default). */
export const stripeForPartners = stripeForAffiliates;

export async function accountRow(userId: string,): Promise<AccountRow | null> {
    const r = await query<AccountRow>(`SELECT user_id, stripe_account_id, details_submitted, payouts_enabled FROM affiliate_accounts WHERE user_id = $1`, [userId,],);
    return r.rows[0] ?? null;
}

export function statusOf(row: AccountRow | null,): AffiliateStripeStatus {
    return { connected: !!row?.stripe_account_id, detailsSubmitted: !!row?.details_submitted, payoutsEnabled: !!row?.payouts_enabled, };
}

/** Transfers reach the account only when its `transfers` capability is active. */
export function payoutsReady(a: Pick<Stripe.Account, 'payouts_enabled' | 'capabilities'>,): boolean {
    return Boolean(a.payouts_enabled,) && a.capabilities?.transfers === 'active';
}

async function save(userId: string, a: Stripe.Account,): Promise<void> {
    await query(
        `INSERT INTO affiliate_accounts (user_id, stripe_account_id, details_submitted, payouts_enabled)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET stripe_account_id = EXCLUDED.stripe_account_id,
             details_submitted = EXCLUDED.details_submitted, payouts_enabled = EXCLUDED.payouts_enabled, updated_at = NOW()`,
        [userId, a.id, Boolean(a.details_submitted,), payoutsReady(a,),],
    );
}

function siteUrl(path: string,): string {
    return `${((config.frontendUrl as string | undefined) ?? '').replace(/\/+$/, '',)}${path}`;
}

/** Create the Express account on first use, then a Stripe-hosted onboarding link. */
export async function onboardingLink(userId: string, email: string | null,): Promise<string> {
    const stripe = stripeForAffiliates();
    let row = await accountRow(userId,);
    if (!row?.stripe_account_id) {
        // Idempotency per 10-minute window: a double click cannot make two
        // accounts, but a failed first try (e.g. Connect not enabled yet) is not
        // replayed by Stripe for 24 h once the operator has fixed it.
        const window = Math.floor(Date.now() / 600_000,);
        const account = await stripe.accounts.create({
            type: 'express',
            email: email ?? undefined,
            capabilities: { transfers: { requested: true, }, },
            metadata: { userId, purpose: 'affiliate', },  // 'affiliate' kept: the webhook + existing accounts match on it
        }, { idempotencyKey: `affiliate-account:${userId}:${window}`, },).catch((e: unknown,) => {
            const msg = (e as Error).message ?? '';
            // Stripe Connect not ready on the platform account: not signed up, or
            // the platform profile (questionnaire) not completed yet.
            if (/signed up for Connect|complete your platform profile/i.test(msg,)) {
                logger.warn('Affiliate onboarding: Stripe Connect is not ready on the shop account', { stripe: msg, },);
                throw new AppError(503, 'CONNECT_NOT_ENABLED', 'Payouts are not set up yet — the shop has not finished setting up Stripe Connect. Please try again later.',);
            }
            throw e;
        },);
        await save(userId, account,);
        row = await accountRow(userId,);
    }
    const link = await stripe.accountLinks.create({
        account: row!.stripe_account_id!,
        refresh_url: siteUrl('/profile?tab=partners&stripe=refresh',),
        return_url: siteUrl('/profile?tab=partners&stripe=return',),
        type: 'account_onboarding',
    },);
    return link.url;
}

/** A one-time link into the affiliate's Stripe Express dashboard. */
export async function dashboardLink(userId: string,): Promise<string> {
    const row = await accountRow(userId,);
    if (!row?.stripe_account_id) throw new ValidationError('Connect your Stripe account first.',);
    const link = await stripeForAffiliates().accounts.createLoginLink(row.stripe_account_id,);
    return link.url;
}

/** Re-read the account from Stripe (after onboarding returns, or "Refresh"). */
export async function refreshStatus(userId: string,): Promise<AffiliateStripeStatus> {
    const row = await accountRow(userId,);
    if (!row?.stripe_account_id) return statusOf(null,);
    try {
        const a = await stripeForAffiliates().accounts.retrieve(row.stripe_account_id,);
        await save(userId, a,);
    } catch (err) {
        logger.warn('Affiliate Stripe account refresh failed', { userId, error: (err as Error).message, },);
    }
    return statusOf(await accountRow(userId,),);
}

/** `account.updated` webhook: keep the stored status in step. */
export async function syncAccount(a: Stripe.Account,): Promise<void> {
    await query(
        `UPDATE affiliate_accounts SET details_submitted = $2, payouts_enabled = $3, updated_at = NOW() WHERE stripe_account_id = $1`,
        [a.id, Boolean(a.details_submitted,), payoutsReady(a,),],
    );
}
