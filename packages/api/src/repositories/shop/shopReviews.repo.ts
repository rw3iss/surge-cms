/**
 * Shop reviews repository — product reviews + ratings with moderation and
 * the denormalized rating aggregate on `shop_products`.
 *
 * Public reads are approved-only (`status = 'approved'`); admin reads see
 * any status. New reviews default to `status = 'pending'` (moderated).
 * `recomputeProductRating` re-derives `rating_avg`/`rating_count` from the
 * approved rows — call it after any create/status-change/delete that
 * affects the approved set. Follows the shopProducts.repo style:
 * base.repo helpers + mapRow + uuidOrNull for the nullable FKs.
 */
import type { ShopReview, ShopReviewStatus, } from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { query, } from '../../db';
import { mapRow, } from '../../utils/mapRow';
import { uuidOrNull, } from '../../utils/uuid';
import {
    deleteById,
    findByIdOrThrow,
    paginatedQuery,
    PaginatedResult,
    PaginationOptions,
} from '../base.repo';

export interface ReviewListFilters {
    productId?: string;
    status?: ShopReviewStatus;
    sort?: string;
}

function buildReviewSortClause(sort?: string,): string {
    // 'helpful' → most-helpful first; anything else → newest first.
    if (sort === 'helpful') return 'ORDER BY helpful_count DESC, created_at DESC';
    return 'ORDER BY created_at DESC';
}

// ─── Lists ────────────────────────────────────────────────────────

/** Public reviews for a product — approved-only, paginated (newest or
 *  most-helpful). Cache-safe (no admin bypass in the query). */
export async function findPublicReviews(
    productId: string,
    pagination: PaginationOptions,
    sort?: string,
): Promise<PaginatedResult<ShopReview>> {
    const whereClause = `WHERE product_id = $1 AND status = 'approved'`;
    const orderClause = buildReviewSortClause(sort,);
    return paginatedQuery<ShopReview>(
        `SELECT * FROM shop_reviews ${whereClause} ${orderClause}`,
        `SELECT COUNT(*) FROM shop_reviews ${whereClause}`,
        [productId,],
        pagination,
    );
}

/** Admin review list — any status, optional product/status filter. */
export async function findAllReviews(
    filters: ReviewListFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<ShopReview>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.productId) {
        params.push(filters.productId,);
        whereClause += ` AND product_id = $${params.length}`;
    }
    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND status = $${params.length}`;
    }

    const orderClause = buildReviewSortClause(filters.sort,);
    return paginatedQuery<ShopReview>(
        // Correlated subquery for the product title (avoids JOIN ambiguity with
        // the shared created_at/status columns used by where/order clauses).
        `SELECT *, (SELECT title FROM shop_products WHERE id = shop_reviews.product_id) AS product_title
             FROM shop_reviews ${whereClause} ${orderClause}`,
        `SELECT COUNT(*) FROM shop_reviews ${whereClause}`,
        params,
        pagination,
    );
}

// ─── Single reads ─────────────────────────────────────────────────

export async function findReviewById(id: string,): Promise<ShopReview> {
    return findByIdOrThrow<ShopReview>('shop_reviews', id, 'Review',);
}

// ─── Writes ───────────────────────────────────────────────────────

export interface ReviewCreateInput {
    productId: string;
    userId?: string | null;
    orderId?: string | null;
    rating: number;
    title?: string | null;
    body?: string | null;
    verifiedPurchase?: boolean;
}

/** Insert a review. Always created `status = 'pending'` (moderated). */
export async function createReview(input: ReviewCreateInput,): Promise<ShopReview> {
    const result = await query(
        `INSERT INTO shop_reviews (product_id, user_id, order_id, rating, title, body,
                                   status, verified_purchase)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
             RETURNING *`,
        [
            input.productId,
            // user_id / order_id are UUID FKs; synthetic/absent actors → NULL.
            uuidOrNull(input.userId ?? null,),
            uuidOrNull(input.orderId ?? null,),
            input.rating,
            input.title ?? null,
            input.body ?? null,
            input.verifiedPurchase ?? false,
        ],
    );
    return mapRow<ShopReview>(result.rows[0],);
}

/** Approve / reject a review. Optionally within the caller's txn client. */
export async function updateReviewStatus(
    id: string,
    status: ShopReviewStatus,
    client?: PoolClient,
): Promise<ShopReview> {
    const sql = `UPDATE shop_reviews SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const params = [id, status,];
    const result = client ? await client.query(sql, params,) : await query(sql, params,);
    return mapRow<ShopReview>(result.rows[0],);
}

export async function deleteReview(id: string,): Promise<void> {
    return deleteById('shop_reviews', id, 'Review',);
}

/** Increment the helpful counter, returning the new count. */
export async function incrementHelpful(id: string,): Promise<number> {
    const result = await query(
        `UPDATE shop_reviews SET helpful_count = helpful_count + 1 WHERE id = $1 RETURNING helpful_count`,
        [id,],
    );
    if (result.rows.length === 0) return 0;
    return result.rows[0].helpful_count as number;
}

/**
 * Recompute the denormalized rating aggregate on a product from its
 * APPROVED reviews. Accepts an optional client so it can run inside the
 * same transaction as a status change. Call after any create (if
 * auto-approved) / status-change / delete affecting approved reviews.
 */
export async function recomputeProductRating(productId: string, client?: PoolClient,): Promise<void> {
    const sql = `UPDATE shop_products SET
             rating_avg = COALESCE(
                 (SELECT AVG(rating) FROM shop_reviews WHERE product_id = $1 AND status = 'approved'), 0),
             rating_count =
                 (SELECT COUNT(*) FROM shop_reviews WHERE product_id = $1 AND status = 'approved')
         WHERE id = $1`;
    const params = [productId,];
    if (client) await client.query(sql, params,);
    else await query(sql, params,);
}
