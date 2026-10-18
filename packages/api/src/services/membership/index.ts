/**
 * A signed-in user managing their own subscription tier (profile → Membership).
 * Stripe stays the source of truth for paid tiers; the local `subscriptions`
 * row mirrors it and the user's role follows the tier (`syncUserRole`).
 *
 *   free → paid  : Stripe subscription created `default_incomplete`; the browser
 *                  confirms the first payment with a card, then `confirm` marks
 *                  it active (the webhook does the same, idempotently).
 *   paid → paid  : immediate, with Stripe proration (`always_invoice`): unused
 *                  time on the old price is credited, the difference is charged
 *                  now — or, on a downgrade, left as credit on the next invoice.
 *                  Refund-and-recharge would mean two card charges and a refund
 *                  delay for the same outcome.
 *   paid → free  : cancel at the end of the period already paid for (`resume`
 *                  undoes it); a hand-assigned tier ends immediately.
 *
 * Every change emails the user (`user_subscription_changed`).
 *
 * Split by job (same pattern as services/events/). Dependencies run one way:
 *   state ← catalog ← current ← change ← approved;  attempts, card beside them.
 */
export { approvedOfferFor, lastFailedAttempt, pendingApplicationFor, } from './state';
export { assertTierPrice, publicTiers, withPrice, } from './catalog';
export { current, overview, } from './current';
export { cancel, change, confirm, frequency, preview, resume, } from './change';
export { settleOpenAttempts, } from './attempts';
export { cardSetup, updateCard, } from './card';
export { startApprovedMembership, } from './approved';
