/**
 * A donor managing their own recurring donations — list, change amount or
 * frequency, cancel — through the site, with Stripe doing the work.
 *
 * Stripe is the source of truth for the schedule (it bills each period); this
 * module reads and edits the Subscription on the DONATIONS account and never
 * mirrors it into our tables. The CMS records only the payments (webhook).
 *
 * Ownership is checked on every call: a subscription belongs to the signed-in
 * user when it is a recurring donation AND its metadata names their user id or
 * their account email (case-insensitive) — the same "id OR email" rule the
 * donation history uses, so a gift made before signing up is still theirs.
 */
import type { RecurringDonation, RecurringDonationUpdateBody, } from '@sitesurge/types';
import { DONATION_INTERVALS, donationInterval, type DonationInterval, } from '@sitesurge/types';
import type Stripe from 'stripe';
import { NotFoundError, ServiceNotConfiguredError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { getStripeClient, } from './payment/stripe';
import { subscriptionPeriod, } from './payment/stripeCompat';

export interface Donor {
    id: string;
    email?: string;
}

function client(): Stripe {
    const c = getStripeClient('donations',);
    if (!c) throw new ServiceNotConfiguredError('Stripe',);
    return c;
}

function owns(sub: Stripe.Subscription, donor: Donor,): boolean {
    const md = sub.metadata ?? {};
    if (md.type !== 'recurring_donation') return false;
    if (md.userId && md.userId === donor.id) return true;
    const email = (donor.email ?? '').trim().toLowerCase();
    return !!email && (md.donorEmail ?? '').trim().toLowerCase() === email;
}

/** Stripe interval + count → our frequency key. */
function intervalOf(price: Stripe.Price,): DonationInterval | null {
    const r = price.recurring;
    if (!r) return null;
    return DONATION_INTERVALS.find((i,) => i.stripe.interval === r.interval && i.stripe.intervalCount === (r.interval_count ?? 1),)?.value
        ?? null;
}

async function campaignsById(ids: string[],): Promise<Map<string, { title: string; slug: string; }>> {
    const out = new Map<string, { title: string; slug: string; }>();
    if (!ids.length) return out;
    const res = await query<{ id: string; title: string; slug: string; }>(
        `SELECT id, title, slug FROM campaigns WHERE id = ANY($1::uuid[])`,
        [ids,],
    );
    for (const r of res.rows) out.set(r.id, { title: r.title, slug: r.slug, },);
    return out;
}

function toView(sub: Stripe.Subscription, campaigns: Map<string, { title: string; slug: string; }>,): RecurringDonation {
    const item = sub.items.data[0];
    const price = item?.price;
    const campaignId = sub.metadata?.campaignId && sub.metadata.campaignId !== 'general' ? sub.metadata.campaignId : null;
    const c = campaignId ? campaigns.get(campaignId,) : undefined;
    const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired';
    // A pending change is held as a trial ending on the next billing date.
    const next = ended ? null : (sub.trial_end ?? subscriptionPeriod(sub,).end);
    return {
        id: sub.id,
        campaignId,
        campaignTitle: c?.title ?? null,
        campaignSlug: c?.slug ?? null,
        amountCents: price?.unit_amount ?? 0,
        currency: (price?.currency ?? 'usd').toUpperCase(),
        interval: price ? intervalOf(price,) : null,
        status: sub.status,
        nextPaymentAt: next ? new Date(next * 1000,).toISOString() : null,
        createdAt: new Date(sub.created * 1000,).toISOString(),
    };
}

async function loadOwned(donor: Donor, id: string,): Promise<Stripe.Subscription> {
    let sub: Stripe.Subscription;
    try {
        sub = await client().subscriptions.retrieve(id,);
    } catch {
        throw new NotFoundError('Recurring donation',);
    }
    // Not theirs → the same 404 as "doesn't exist", so ids can't be probed.
    if (!owns(sub, donor,)) throw new NotFoundError('Recurring donation',);
    return sub;
}

/**
 * The donor's recurring donations, newest first. Found from the payments we
 * recorded for them (their id or email), then read live from Stripe.
 */
export async function listForDonor(donor: Donor,): Promise<RecurringDonation[]> {
    const email = (donor.email ?? '').trim().toLowerCase();
    const res = await query<{ stripe_subscription_id: string; }>(
        `SELECT DISTINCT stripe_subscription_id FROM donations
          WHERE stripe_subscription_id IS NOT NULL
            AND (user_id = $1 ${email ? 'OR LOWER(donor_email) = $2' : ''})`,
        email ? [donor.id, email,] : [donor.id,],
    );
    if (!res.rows.length) return [];
    const c = getStripeClient('donations',);
    if (!c) return [];
    const subs = (await Promise.all(res.rows.map(async (r,) => {
        try {
            return (await c.subscriptions.retrieve(r.stripe_subscription_id,)) as Stripe.Subscription;
        } catch (err) {
            logger.warn('recurring donation lookup failed', { id: r.stripe_subscription_id, error: (err as Error).message, },);
            return null;
        }
    },),)).filter((s,): s is Stripe.Subscription => s !== null && owns(s, donor,));
    const campaigns = await campaignsById(
        [...new Set(subs.map((s,) => s.metadata?.campaignId,).filter((x,): x is string => !!x && x !== 'general',),),],
    );
    return subs.map((s,) => toView(s, campaigns,)).sort((a, b,) => b.createdAt.localeCompare(a.createdAt,));
}

/**
 * Change the amount and/or frequency. Takes effect from the NEXT charge: the
 * new price is swapped in with no proration, and the current paid period is
 * kept as a trial ending on the date the donor was already due to pay — a
 * frequency change would otherwise restart billing and charge them today.
 */
export async function update(donor: Donor, id: string, body: RecurringDonationUpdateBody,): Promise<RecurringDonation> {
    const sub = await loadOwned(donor, id,);
    if (sub.status === 'canceled' || sub.status === 'incomplete_expired') {
        throw new ValidationError('This recurring donation has ended.',);
    }
    const item = sub.items.data[0];
    const price = item.price;
    const amount = body.amountCents ?? price.unit_amount ?? 0;
    if (!Number.isInteger(amount,) || amount < 100) throw new ValidationError('The minimum donation is $1.00.',);
    const iv = body.interval ? donationInterval(body.interval,) : donationInterval(intervalOf(price,),);
    if (!iv) throw new ValidationError('Unknown donation frequency.',);

    const unchanged = amount === price.unit_amount && iv.value === intervalOf(price,);
    if (!unchanged) {
        const productId = typeof price.product === 'string' ? price.product : price.product.id;
        const nextCharge = sub.trial_end ?? subscriptionPeriod(sub,).end;
        const params: Stripe.SubscriptionUpdateParams = {
            items: [{
                id: item.id,
                price_data: {
                    currency: price.currency,
                    product: productId,
                    unit_amount: amount,
                    recurring: { interval: iv.stripe.interval, interval_count: iv.stripe.intervalCount, },
                },
            },],
            proration_behavior: 'none',
            metadata: { ...sub.metadata, recurringInterval: iv.value, },
        };
        if (nextCharge * 1000 > Date.now() + 60_000) params.trial_end = nextCharge;
        await client().subscriptions.update(id, params,);
        logger.info('Recurring donation changed by donor', { id, amount, interval: iv.value, },);
    }
    const fresh = await client().subscriptions.retrieve(id,);
    const campaigns = await campaignsById(fresh.metadata?.campaignId ? [fresh.metadata.campaignId,] : [],);
    return toView(fresh, campaigns,);
}

/** Stop it now — no further charges. Past payments stay recorded. */
export async function cancel(donor: Donor, id: string,): Promise<RecurringDonation> {
    const sub = await loadOwned(donor, id,);
    const done = sub.status === 'canceled' ? sub : await client().subscriptions.cancel(id,);
    logger.info('Recurring donation cancelled by donor', { id, },);
    const campaigns = await campaignsById(done.metadata?.campaignId ? [done.metadata.campaignId,] : [],);
    return toView(done, campaigns,);
}
