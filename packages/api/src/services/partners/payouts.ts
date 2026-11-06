/**
 * PARTNER payouts — one Stripe transfer of a program's PAYABLE balance to the
 * partner's Connect Express account. Each program is a SOURCE with its own
 * earnings table; a payout pays one source (`affiliate_payouts.source`), so an
 * affiliate payout never sweeps up contribution earnings and vice versa.
 *
 * Money safety:
 *   - Earnings are CLAIMED first (`payout_id` set inside a transaction) so two
 *     runs can never pay the same row. One `pending` payout per (partner,
 *     source) at a time (unique index, migration 212).
 *   - A DEFINITE Stripe refusal (4xx: no balance, account not ready…) marks
 *     the payout `failed` and releases the earnings for the next try.
 *   - An UNCLEAR failure (network, timeout, Stripe 5xx) — the transfer may have
 *     gone through — keeps the payout `pending` with its earnings claimed. The
 *     next payout for that partner first RESUMES it: it looks the transfer up
 *     at Stripe (by `transfer_group` / `metadata.payoutId`) and only creates
 *     it (same idempotency key) when Stripe has none. Releasing on an unclear
 *     error was how a payout could be paid twice.
 *   - A database error AFTER Stripe accepted the transfer never releases the
 *     claim (the payout stays `pending` and the resume marks it paid).
 */
import type { AffiliatePayoutResult, } from '@sitesurge/types';
import type Stripe from 'stripe';
import { query, transaction, } from '../../db';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';
import { logAudit, } from '../audit';
import { accountRow, stripeForPartners, } from './stripeConnect';

export type PayoutSource = 'affiliate' | 'contribution';

interface SourceDef {
    table: string;
    /** Rows of this table that are payable now. */
    payable: string;
    /** Status that marks a paid row. */
    paidStatus: string;
    description: string;
    noun: string;
}

export const PAYOUT_SOURCES: Record<PayoutSource, SourceDef> = {
    affiliate: {
        table: 'affiliate_earnings',
        payable: `status = 'earned' AND payout_id IS NULL AND available_at <= NOW()`,
        paidStatus: 'paid',
        description: 'Affiliate commission payout',
        noun: 'commissions',
    },
    contribution: {
        table: 'contribution_earnings',
        payable: `status = 'earned' AND payout_id IS NULL AND available_at <= NOW()`,
        paidStatus: 'paid',
        description: 'Contributor payout',
        noun: 'contribution earnings',
    },
};

/** A pending payout younger than this may still be in flight in another process. */
const IN_FLIGHT_MS = 2 * 60_000;

const money = (c: number, cur: string,) => `${(c / 100).toFixed(2,)} ${cur.toUpperCase()}`;

/**
 * Could the transfer have been created even though the call failed? True for
 * network errors, timeouts, Stripe 5xx and anything that is not a Stripe API
 * answer. False for a Stripe 4xx (the request was refused, nothing created).
 */
export function isAmbiguousTransferError(err: unknown,): boolean {
    const e = err as { type?: string; statusCode?: number; } | null;
    if (!e || typeof e !== 'object') return true;
    if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') return true;
    if (typeof e.statusCode === 'number') return e.statusCode >= 500;
    // A Stripe error type without a status (rare) is a refusal; anything else is unknown.
    return !(typeof e.type === 'string' && e.type.startsWith('Stripe',) && e.type !== 'StripeError');
}

interface Claim { payoutId: string; total: number; currency: string; createdAt: Date; }

function transferParams(claim: Claim, destination: string, userId: string, source: PayoutSource,): Stripe.TransferCreateParams {
    return {
        amount: claim.total,
        currency: claim.currency,
        destination,
        description: PAYOUT_SOURCES[source].description,
        transfer_group: `payout_${claim.payoutId}`,
        metadata: { payoutId: claim.payoutId, userId, purpose: `${source}_payout`, },
    };
}

/** A transfer Stripe already made for this payout (a resumed payout), else null. */
async function findExistingTransfer(stripe: Stripe, claim: Claim, destination: string,): Promise<Stripe.Transfer | null> {
    const byGroup = await stripe.transfers.list({ transfer_group: `payout_${claim.payoutId}`, limit: 1, },);
    if (byGroup.data[0]) return byGroup.data[0];
    // Payouts made before `transfer_group` was set: match the metadata.
    const since = Math.floor(claim.createdAt.getTime() / 1000,) - 3600;
    const recent = await stripe.transfers.list({ destination, created: { gte: since, }, limit: 100, },);
    return recent.data.find((t,) => t.metadata?.payoutId === claim.payoutId,) ?? null;
}

async function markPaid(claim: Claim, source: PayoutSource, transferId: string,): Promise<void> {
    const def = PAYOUT_SOURCES[source];
    await transaction(async (c,) => {
        await c.query(`UPDATE affiliate_payouts SET status = 'paid', stripe_transfer_id = $2, error = NULL, updated_at = NOW() WHERE id = $1`, [claim.payoutId, transferId,],);
        await c.query(`UPDATE ${def.table} SET status = '${def.paidStatus}', updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
    },);
}

/** Claim every payable row (one currency at a time) into a new pending payout. */
async function claimPayable(userId: string, source: PayoutSource, trigger: 'manual' | 'auto', actorId: string | null,): Promise<Claim | null | 'busy'> {
    const def = PAYOUT_SOURCES[source];
    try {
        return await transaction(async (c,) => {
            // The oldest payable row decides the currency (mixed currencies pay in separate runs).
            const cur = await c.query<{ currency: string; }>(
                `SELECT currency FROM ${def.table} WHERE user_id = $1 AND ${def.payable} ORDER BY available_at, created_at LIMIT 1`, [userId,],
            );
            if (!cur.rows[0]) return null;
            const currency = cur.rows[0].currency || 'usd';
            const p = await c.query<{ id: string; created_at: Date; }>(
                `INSERT INTO affiliate_payouts (user_id, amount_cents, currency, trigger, created_by, source) VALUES ($1, 0, $2, $3, $4, $5) RETURNING id, created_at`,
                [userId, currency, trigger, uuidOrNull(actorId,), source,],
            );
            const payoutId = p.rows[0].id;
            const e = await c.query<{ amount_cents: number; }>(
                `UPDATE ${def.table} SET payout_id = $2, updated_at = NOW() WHERE user_id = $1 AND currency = $3 AND ${def.payable} RETURNING amount_cents`,
                [userId, payoutId, currency,],
            );
            const total = e.rows.reduce((s, r,) => s + Number(r.amount_cents,), 0,);
            if (total <= 0) {
                // Reversals outweigh commissions (or nothing left): undo the claim.
                await c.query(`UPDATE ${def.table} SET payout_id = NULL WHERE payout_id = $1`, [payoutId,],);
                await c.query(`DELETE FROM affiliate_payouts WHERE id = $1`, [payoutId,],);
                return null;
            }
            await c.query(`UPDATE affiliate_payouts SET amount_cents = $2 WHERE id = $1`, [payoutId, total,],);
            return { payoutId, total, currency, createdAt: new Date(p.rows[0].created_at,), };
        },);
    } catch (err) {
        // uq_affiliate_payouts_pending: another payout for this partner + program is in flight.
        if ((err as { code?: string; }).code === '23505') return 'busy';
        throw err;
    }
}

/** The partner's unfinished payout of this program (left by an unclear failure or a crash). */
async function pendingClaim(userId: string, source: PayoutSource,): Promise<Claim | null> {
    const r = await query<{ id: string; amount_cents: number; currency: string; created_at: Date; }>(
        `SELECT id, amount_cents, currency, created_at FROM affiliate_payouts
          WHERE user_id = $1 AND source = $2 AND status = 'pending' AND amount_cents > 0
          ORDER BY created_at LIMIT 1`,
        [userId, source,],
    );
    const p = r.rows[0];
    return p ? { payoutId: p.id, total: Number(p.amount_cents,), currency: p.currency || 'usd', createdAt: new Date(p.created_at,), } : null;
}

/** Send (or find) the transfer for a claim and settle the payout. Never throws for a Stripe failure. */
async function settle(
    claim: Claim, userId: string, destination: string, source: PayoutSource, trigger: 'manual' | 'auto', actorId: string | null, resume: boolean,
): Promise<AffiliatePayoutResult> {
    const def = PAYOUT_SOURCES[source];
    const stripe = stripeForPartners();
    let transfer: Stripe.Transfer;
    try {
        transfer = (resume ? await findExistingTransfer(stripe, claim, destination,) : null)
            ?? await stripe.transfers.create(transferParams(claim, destination, userId, source,), { idempotencyKey: `${source}-payout:${claim.payoutId}`, },);
    } catch (err) {
        const message = ((err as Error).message || 'Transfer failed').slice(0, 500,);
        if (isAmbiguousTransferError(err,)) {
            // The transfer may exist: keep the claim; the next payout resumes it.
            await query(`UPDATE affiliate_payouts SET error = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, message,],);
            logger.error('Partner payout: transfer outcome unknown — kept pending for a retry', { userId, source, payoutId: claim.payoutId, error: message, },);
            return { paid: false, amountCents: 0, message: `Stripe did not answer clearly (${message}). The payout is kept and will be checked on the next try — do not pay this partner by hand.`, };
        }
        await query(`UPDATE affiliate_payouts SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [claim.payoutId, message,],);
        await query(`UPDATE ${def.table} SET payout_id = NULL, updated_at = NOW() WHERE payout_id = $1`, [claim.payoutId,],);
        logger.error('Partner payout transfer failed', { userId, source, payoutId: claim.payoutId, error: message, },);
        return { paid: false, amountCents: 0, message: `The transfer failed: ${message}`, };
    }
    try {
        await markPaid(claim, source, transfer.id,);
    } catch (err) {
        // Stripe paid; never release the claim. The next payout's resume finds the transfer.
        logger.error('Partner payout: transfer made but not recorded — the next payout will record it', { userId, source, payoutId: claim.payoutId, transferId: transfer.id, error: (err as Error).message, },);
    }
    await logAudit({ userId: actorId ?? '', action: 'payout', entityType: source, entityId: userId, newValues: { amountCents: claim.total, trigger, transferId: transfer.id, resumed: resume, }, },)
        .catch(() => {},);
    return { paid: true, amountCents: claim.total, message: `Paid ${money(claim.total, claim.currency,)}.`, };
}

/** Pay a partner's payable balance of ONE program. Never throws for a Stripe failure (returns `paid: false`). */
export async function payOutSource(
    userId: string,
    source: PayoutSource,
    trigger: 'manual' | 'auto',
    actorId: string | null,
): Promise<AffiliatePayoutResult> {
    const def = PAYOUT_SOURCES[source];
    const acct = await accountRow(userId,);
    if (!acct?.stripe_account_id || !acct.payouts_enabled) {
        return { paid: false, amountCents: 0, message: 'This partner has not finished connecting their Stripe account.', };
    }
    stripeForPartners(); // fails early with a clear message when Stripe is not connected

    // An unfinished payout first: settle it before claiming anything new.
    const pending = await pendingClaim(userId, source,);
    if (pending) {
        if (Date.now() - pending.createdAt.getTime() < IN_FLIGHT_MS) {
            return { paid: false, amountCents: 0, message: 'A payout for this partner is already in progress. Try again in a few minutes.', };
        }
        const resumed = await settle(pending, userId, acct.stripe_account_id, source, trigger, actorId, true,);
        if (!resumed.paid) return resumed;
        const more = await payOutSource(userId, source, trigger, actorId,);
        return more.paid
            ? { paid: true, amountCents: resumed.amountCents + more.amountCents, message: `${resumed.message} ${more.message}`, }
            : resumed;
    }

    const claim = await claimPayable(userId, source, trigger, actorId,);
    if (claim === 'busy') return { paid: false, amountCents: 0, message: 'A payout for this partner is already in progress. Try again in a few minutes.', };
    if (!claim) return { paid: false, amountCents: 0, message: `Nothing is payable yet (no ${def.noun} past their holding period).`, };
    return settle(claim, userId, acct.stripe_account_id, source, trigger, actorId, false,);
}

/** Partners of a source with a payable balance (or an unfinished payout) and a ready Stripe account. */
export async function payableUsers(source: PayoutSource,): Promise<string[]> {
    const def = PAYOUT_SOURCES[source];
    const r = await query<{ user_id: string; }>(
        `SELECT e.user_id FROM ${def.table} e JOIN affiliate_accounts a ON a.user_id = e.user_id AND a.payouts_enabled
          WHERE ${def.payable.replace(/(status|payout_id|available_at)/g, 'e.$1',)}
          GROUP BY e.user_id HAVING SUM(e.amount_cents) > 0
         UNION
         SELECT p.user_id FROM affiliate_payouts p JOIN affiliate_accounts a ON a.user_id = p.user_id AND a.payouts_enabled
          WHERE p.source = $1 AND p.status = 'pending' AND p.amount_cents > 0`,
        [source,],
    );
    return r.rows.map((x,) => x.user_id,);
}
