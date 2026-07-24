/**
 * Shop order fulfillment — the webhook-time finalization of a paid order,
 * invoked from the payments webhook dispatcher when a
 * `payment_intent.succeeded` carries `metadata.orderType === 'shop'`.
 *
 * Idempotent (webhooks retry): the mark-paid UPDATE is guarded to only
 * flip a `pending` order, so a second delivery is a no-op. All state
 * changes run in one transaction; the receipt email is sent AFTER commit
 * and its failure never throws (the payment is already captured).
 */
import type Stripe from 'stripe';
import { transaction, query, } from '../../db';
import { logger, } from '../../utils/logger';
import { randomBytes, } from 'crypto';
import * as ordersRepo from '../../repositories/shop/shopOrders.repo';
import { sendOrderPlacedEmails, } from './orderEmails';

/**
 * Finalize a shop order from a succeeded PaymentIntent. Marks the order
 * paid, decrements variant inventory (oversell-guarded), generates
 * download tokens for digital items, and records a `purchase` transaction.
 * A no-op when the order is already beyond `pending`.
 */
export async function fulfillShopOrder(paymentIntent: Stripe.PaymentIntent,): Promise<void> {
    const orderId = paymentIntent.metadata?.orderId;
    if (!orderId) {
        logger.warn('Shop PaymentIntent succeeded without an orderId in metadata', {
            paymentIntentId: paymentIntent.id,
        },);
        return;
    }

    const chargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id ?? null;

    const outcome = await transaction(async (client,) => {
        const { updated, } = await ordersRepo.markOrderPaid(client, orderId, { stripeChargeId: chargeId, },);
        if (!updated) {
            // Already paid/beyond (webhook retry, or a prior fulfillment) →
            // idempotent no-op.
            return { fulfilled: false, };
        }

        const items = await ordersRepo.findOrderItemsForFulfillment(client, orderId,);
        for (const item of items) {
            if (item.variantId) {
                const { ok, } = await ordersRepo.decrementInventory(client, item.variantId, item.quantity,);
                if (!ok) {
                    logger.warn('Oversell on fulfillment — variant clamped to 0', {
                        orderId, variantId: item.variantId, requested: item.quantity,
                    },);
                }
            }
            if (item.isDigital) {
                const token = randomBytes(24,).toString('hex',);
                await ordersRepo.setDownloadToken(client, item.id, token,);
            }
        }

        // Record a purchase transaction (mirrors the donation transaction
        // insert; transactions has no shop-order FK so the order ref lives
        // in metadata).
        const orderRow = await client.query(
            `SELECT user_id, total_cents, currency, order_number FROM shop_orders WHERE id = $1`,
            [orderId,],
        );
        if (orderRow.rows.length > 0) {
            const o = orderRow.rows[0];
            await client.query(
                `INSERT INTO transactions (user_id, type, amount_cents, currency, status,
                                           stripe_payment_intent_id, stripe_charge_id, description, metadata)
                     VALUES ($1, 'purchase', $2, $3, 'completed', $4, $5, $6, $7)
                     ON CONFLICT DO NOTHING`,
                [
                    o.user_id,
                    o.total_cents,
                    o.currency,
                    paymentIntent.id,
                    chargeId,
                    `Shop order ${o.order_number}`,
                    JSON.stringify({ orderId, orderNumber: o.order_number, },),
                ],
            );
        }

        return { fulfilled: true, };
    },);

    if (!outcome.fulfilled) {
        logger.info('Shop order already fulfilled — webhook no-op', { orderId, },);
        return;
    }

    logger.info('Shop order fulfilled via webhook', { orderId, paymentIntentId: paymentIntent.id, },);

    // Order-paid emails (buyer confirmation + seller notification) — after
    // commit; the send helper never throws (payment already captured).
    try {
        const detail = await query(
            `SELECT * FROM shop_orders WHERE id = $1`,
            [orderId,],
        );
        if (detail.rows.length > 0) {
            const order = await ordersRepo.findOrderById(orderId,);
            await sendOrderPlacedEmails(order,);
        }
    } catch (err) {
        logger.error('Failed to send shop order emails', { orderId, error: err, },);
    }

    // Printify fulfillment — submit the order to Printify if it contains any
    // Printify products. Post-commit + best-effort: the payment is already
    // captured, so a Printify API failure must never fail the webhook (it's
    // retried by the poller / can be re-submitted). No-op when Printify is off.
    try {
        const { submitOrderToPrintify, } = await import('../printify/fulfillment.js');
        await submitOrderToPrintify(orderId,);
    } catch (err) {
        logger.error('Printify order submission failed (payment captured; will retry)', { orderId, error: err, },);
    }
}
