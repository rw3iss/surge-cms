/**
 * Shop orders service — role-shaped reads (admin all / user own), admin
 * status/fulfillment updates (incl. Stripe refund), receipt resend, and
 * the token-gated digital-download resolution.
 *
 * Orders are user-specific / admin — NEVER cached. `isAdminRole || apiKey`
 * selects the admin view; the user tier is scoped to their own orders by
 * user_id OR customer_email.
 */
import type { ShopOrder, } from '@rw/cms-shared';
import Stripe from 'stripe';
import { config, } from '../../config';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { logger, } from '../../utils/logger';
import * as repo from '../../repositories/shop/shopOrders.repo';
import { sendOrderReceipt, } from './receipt';
import type { AuditContext, ListResult, PaginationOpts, } from '../types';

export type { OrderDetail, } from '../../repositories/shop/shopOrders.repo';

/** Caller shape for the role-scoped reads. */
export interface OrderCaller {
    isAdmin: boolean;
    userId?: string | null;
    email?: string | null;
}

// ─── Reads ─────────────────────────────────────────────────────────

export interface OrderListParams {
    status?: string;
}

/** List orders. Admin → all; user → own (user_id OR email). Never cached. */
export async function list(
    params: OrderListParams,
    caller: OrderCaller,
    pagination: PaginationOpts = {},
): Promise<ListResult<ShopOrder>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;

    const filters: repo.OrderListFilters = { status: params.status, };
    if (!caller.isAdmin) {
        filters.userId = caller.userId ?? undefined;
        filters.email = caller.email ?? undefined;
        // A user with neither id nor email can't own anything.
        if (!filters.userId && !filters.email) {
            return { data: [], meta: { page, limit, total: 0, totalPages: 0, }, };
        }
    }

    const result = await repo.findOrders(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

function assertOwnership(order: repo.OrderDetail, caller: OrderCaller,): void {
    if (caller.isAdmin) return;
    const ownByUser = caller.userId && order.userId === caller.userId;
    const ownByEmail = caller.email && order.customerEmail === caller.email;
    if (!ownByUser && !ownByEmail) throw new NotFoundError('Order',);
}

/** Full order detail by id. Admin → any; user → own (else 404). */
export async function get(id: string, caller: OrderCaller,): Promise<repo.OrderDetail> {
    const order = await repo.findOrderById(id,);
    assertOwnership(order, caller,);
    return order;
}

/** Public confirmation view by order number. Anonymous callers get a
 *  limited projection (no addresses / stripe ids); admins get everything. */
export async function getByNumber(orderNumber: string, isAdmin: boolean,): Promise<repo.OrderDetail | null> {
    const order = await repo.findOrderByNumber(orderNumber,);
    if (!order) return null;
    if (isAdmin) return order;
    // Limited public projection for the confirmation page.
    return {
        ...order,
        userId: null,
        shippingAddress: null,
        billingAddress: null,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        notes: null,
    };
}

// ─── Admin updates ─────────────────────────────────────────────────

export interface OrderUpdatePatch {
    status?: string;
    fulfillmentStatus?: string;
    trackingNumber?: string | null;
    notes?: string | null;
}

/** Issue a Stripe refund for an order. Wrapped by the caller in try/catch —
 *  succeeds silently when no payment intent is on the order. */
async function refundOrder(order: repo.OrderDetail,): Promise<void> {
    if (!config.stripe.secretKey) {
        throw new ValidationError('Stripe is not configured — cannot refund',);
    }
    if (!order.stripePaymentIntentId) {
        throw new ValidationError('Order has no payment to refund',);
    }
    const stripe = new Stripe(config.stripe.secretKey,);
    await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, },);
}

/**
 * Admin order update. Applies status/fulfillment/tracking/notes; a
 * transition to `refunded` also issues a Stripe refund (the DB status is
 * only flipped once the refund succeeds).
 */
export async function update(id: string, patch: OrderUpdatePatch, ctx: AuditContext,): Promise<repo.OrderDetail> {
    const existing = await repo.findOrderById(id,);

    if (patch.status === 'refunded' && existing.status !== 'refunded') {
        await refundOrder(existing,);
    }

    await repo.updateOrder(id, {
        status: patch.status,
        fulfillmentStatus: patch.fulfillmentStatus,
        trackingNumber: patch.trackingNumber,
        notes: patch.notes,
    },);

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'shop-order',
        entityId: id,
        newValues: patch as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    return repo.findOrderById(id,);
}

/** Re-send the receipt email for an order (admin). */
export async function resendReceipt(id: string, ctx: AuditContext,): Promise<{ message: string; }> {
    const order = await repo.findOrderById(id,);
    await sendOrderReceipt(order,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'shop-order',
        entityId: id,
        newValues: { action: 'resend-receipt', },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { message: 'Receipt sent', };
}

// ─── Digital download ──────────────────────────────────────────────

/** Resolve a token-gated digital download to a file URL. Public but
 *  guarded by the unguessable token + paid-order status. */
export async function getDigitalDownload(orderNumber: string, token: string,): Promise<{ url: string; }> {
    const item = await repo.findDigitalItemByToken(orderNumber, token,);
    if (!item || !item.productId) {
        throw new ForbiddenError('Invalid or expired download link',);
    }
    const url = await repo.findDigitalFileUrl(item.productId,);
    if (!url) {
        logger.warn('Digital item has no downloadable media', { orderNumber, productId: item.productId, },);
        throw new NotFoundError('Download',);
    }
    return { url, };
}
