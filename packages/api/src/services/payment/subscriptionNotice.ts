/**
 * The admin `subscription_change` notification for Stripe membership events
 * (created / updated / deleted). Built through the shared notification
 * builder: the member, the level (old → new when it changed), status in plain
 * words, price + frequency, cancellation, and links to the member + Stripe.
 */
import type Stripe from 'stripe';
import { query, } from '../../db';
import {
    buildNotification, formatDay, notifyUser, notifyWith, personLabel, subscriptionStatusLabel,
    type NotificationMessage, type NotifyRow,
} from '../notifications';

export type SubscriptionEventKind = 'created' | 'updated' | 'deleted';

interface PlanRow { id: string; name: string; }

async function planFor(priceId: string | null | undefined, productId: string | null | undefined,): Promise<PlanRow | null> {
    if (!priceId && !productId) return null;
    const r = await query<PlanRow>(
        `SELECT id, name FROM subscription_plans
          WHERE ($1::text IS NOT NULL AND stripe_price_id = $1) OR ($2::text IS NOT NULL AND stripe_product_id = $2)
          ORDER BY (stripe_price_id = $1) DESC NULLS LAST LIMIT 1`,
        [priceId ?? null, productId ?? null,],
    );
    return r.rows[0] ?? null;
}

type PriceLike = Pick<Stripe.Price, 'id' | 'unit_amount' | 'currency' | 'recurring'> & { product?: string | { id: string; } | null; };

function firstPrice(items: { data?: Array<{ price?: unknown; }>; } | undefined,): PriceLike | null {
    const p = items?.data?.[0]?.price as PriceLike | undefined;
    return p && typeof p === 'object' ? p : null;
}

const productIdOf = (p: PriceLike | null,): string | null =>
    !p?.product ? null : typeof p.product === 'string' ? p.product : p.product.id;

export function priceLabel(p: PriceLike | null,): string {
    if (!p || p.unit_amount === null || p.unit_amount === undefined) return '';
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: (p.currency || 'usd').toUpperCase(), },)
        .format(p.unit_amount / 100,);
    const r = p.recurring;
    if (!r) return amount;
    const n = r.interval_count ?? 1;
    return `${amount} ${n === 1 ? `/ ${r.interval}` : `every ${n} ${r.interval}s`}`;
}

/** Build the message (exported for tests). */
export async function buildSubscriptionNotice(
    kind: SubscriptionEventKind,
    sub: Stripe.Subscription,
    previous?: Partial<Stripe.Subscription> | null,
): Promise<NotificationMessage> {
    const local = (await query<{ user_id: string; plan_name: string | null; }>(
        `SELECT s.user_id, p.name AS plan_name FROM subscriptions s LEFT JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.stripe_subscription_id = $1 LIMIT 1`,
        [sub.id,],
    )).rows[0];
    const price = firstPrice(sub.items as never,);
    const plan = await planFor(price?.id, productIdOf(price,),);
    const level = plan?.name || local?.plan_name || sub.metadata?.tierName || 'Membership';

    const prevPrice = previous?.items ? firstPrice(previous.items as never,) : null;
    const prevPlan = prevPrice && prevPrice.id !== price?.id ? await planFor(prevPrice.id, productIdOf(prevPrice,),) : null;
    const levelChanged = Boolean(prevPlan && prevPlan.name !== level,);
    const billingChanged = Boolean(prevPrice && prevPrice.id !== price?.id && !levelChanged,);

    const person = await notifyUser({ userId: local?.user_id ?? sub.metadata?.userId ?? null, },);
    const who = personLabel(person, 'A member',);

    // What happened, in one phrase.
    let headline: string;
    let intro: string;
    if (kind === 'created') {
        headline = sub.status === 'incomplete' ? 'Membership started — awaiting payment' : 'Membership started';
        intro = sub.status === 'incomplete'
            ? `${who} started ${level}. The first payment has not completed yet.`
            : `${who} started ${level}.`;
    } else if (kind === 'deleted') {
        headline = 'Membership cancelled';
        intro = `${who}'s ${level} membership has ended.`;
    } else if (previous?.status === 'incomplete' && (sub.status === 'active' || sub.status === 'trialing')) {
        headline = 'Membership payment received';
        intro = `${who}'s first payment for ${level} went through. The membership is active.`;
    } else if (levelChanged) {
        headline = 'Membership changed';
        intro = `${who} moved from ${prevPlan!.name} to ${level}.`;
    } else if (previous && 'cancel_at_period_end' in previous && sub.cancel_at_period_end && !previous.cancel_at_period_end) {
        headline = 'Membership set to cancel';
        intro = `${who} cancelled ${level}. It stays active until the end of the period.`;
    } else if (previous && 'cancel_at_period_end' in previous && !sub.cancel_at_period_end && previous.cancel_at_period_end) {
        headline = 'Membership resumed';
        intro = `${who} resumed ${level}. It will renew as normal.`;
    } else if (billingChanged) {
        headline = 'Membership billing changed';
        intro = `${who} changed billing for ${level}.`;
    } else if (previous?.status && previous.status !== sub.status) {
        headline = 'Membership status changed';
        intro = `${who}'s ${level} membership is now: ${subscriptionStatusLabel(sub.status,)}.`;
    } else {
        headline = 'Membership updated';
        intro = `${who}'s ${level} membership was updated.`;
    }

    const periodEnd = sub.items?.data?.[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number; }).current_period_end;
    const rows: NotifyRow[] = [
        { label: 'Level', value: levelChanged ? `${prevPlan!.name} → ${level}` : level, },
        { label: 'Status', value: kind === 'deleted' ? 'Cancelled' : subscriptionStatusLabel(sub.status,), },
        {
            label: 'Price',
            value: billingChanged && priceLabel(prevPrice,) ? `${priceLabel(prevPrice,)} → ${priceLabel(price,)}` : priceLabel(price,),
        },
        {
            label: 'Cancels at period end',
            value: kind === 'deleted' ? null : sub.cancel_at_period_end ? 'Yes' : 'No',
        },
        {
            label: kind === 'deleted' ? 'Ended' : sub.cancel_at_period_end ? 'Ends' : 'Renews',
            value: kind === 'deleted'
                ? formatDay(sub.ended_at ? new Date(sub.ended_at * 1000,) : new Date(),)
                : periodEnd ? formatDay(new Date(periodEnd * 1000,),) : null,
        },
        { label: 'Stripe subscription', value: sub.id, },
    ];

    return buildNotification({
        title: headline,
        subject: `${headline} — ${who} (${levelChanged ? `${prevPlan!.name} → ${level}` : level})`,
        intro,
        person,
        sections: [{ heading: 'Membership', rows, },],
        links: [
            ...(person?.adminUrl ? [{ label: 'View member', url: person.adminUrl, },] : []),
            { label: 'Open in Stripe', url: `https://dashboard.stripe.com/subscriptions/${sub.id}`, },
        ],
    },);
}

/** Fire-and-forget admin notification for a Stripe membership event. */
export function notifySubscriptionChange(
    kind: SubscriptionEventKind,
    sub: Stripe.Subscription,
    previous?: Partial<Stripe.Subscription> | null,
): void {
    // A new subscription still `incomplete` is an unpaid attempt — most are
    // cancelled by settleOpenAttempts when the member retries. The
    // incomplete → active "payment received" notice covers the one that pays.
    if (kind === 'created' && sub.status === 'incomplete') return;
    const fallbackTitle = kind === 'created' ? 'Membership started' : kind === 'deleted' ? 'Membership cancelled' : 'Membership updated';
    void notifyWith('subscription_change', () => buildSubscriptionNotice(kind, sub, previous,), {
        subject: fallbackTitle,
        text: `${fallbackTitle}\nStatus: ${subscriptionStatusLabel(sub.status,)}\nStripe subscription: ${sub.id}`,
    },);
}
