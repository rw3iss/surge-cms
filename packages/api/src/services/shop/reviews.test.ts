import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
const delPatternMock = vi.fn();
vi.mock('../cache', () => ({
    cache: {
        get: vi.fn().mockResolvedValue(null,),
        set: vi.fn(),
        del: vi.fn(),
        delPattern: (...a: unknown[]) => delPatternMock(...a),
    },
}),);

vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

// transaction(cb) runs the callback with a fake client that records SQL.
const txnQueries: { sql: string; params?: unknown[]; }[] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        txnQueries.push({ sql, params, },);
        // updateReviewStatus RETURNING * → hand back a review row.
        return { rows: [{ id: 'r1', product_id: 'p1', status: 'approved', }], };
    }),
};
// top-level query() (verified-purchase lookup, non-txn recompute, insert).
const queryMock = vi.fn(async () => ({ rows: [], }));
vi.mock('../../db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    transaction: async (cb: (c: unknown,) => Promise<unknown>,) => cb(fakeClient,),
}),);

const createReviewMock = vi.fn().mockResolvedValue({ id: 'r1', productId: 'p1', status: 'pending', });
const findReviewByIdMock = vi.fn();
const updateReviewStatusMock = vi.fn().mockResolvedValue({ id: 'r1', productId: 'p1', status: 'approved', },);
const recomputeProductRatingMock = vi.fn().mockResolvedValue(undefined,);
const deleteReviewMock = vi.fn().mockResolvedValue(undefined,);

vi.mock('../../repositories/shop/shopReviews.repo', () => ({
    createReview: (...a: unknown[]) => createReviewMock(...a),
    findReviewById: (...a: unknown[]) => findReviewByIdMock(...a),
    updateReviewStatus: (...a: unknown[]) => updateReviewStatusMock(...a),
    recomputeProductRating: (...a: unknown[]) => recomputeProductRatingMock(...a),
    deleteReview: (...a: unknown[]) => deleteReviewMock(...a),
    incrementHelpful: vi.fn().mockResolvedValue(1,),
    findPublicReviews: vi.fn().mockResolvedValue({ data: [], total: 0, }),
    findAllReviews: vi.fn().mockResolvedValue({ data: [], total: 0, },),
}),);

import * as reviews from './reviews';

const ctx = { userId: 'u1', ipAddress: '', userAgent: '', };

describe('shop reviews service', () => {
    beforeEach(() => {
        delPatternMock.mockReset();
        txnQueries.length = 0;
        fakeClient.query.mockClear();
        queryMock.mockClear();
        createReviewMock.mockClear();
        updateReviewStatusMock.mockClear();
        recomputeProductRatingMock.mockClear();
        deleteReviewMock.mockClear();
        findReviewByIdMock.mockReset();
    },);

    it('create sets status pending and does NOT recompute rating', async () => {
        // No verified purchase (empty lookup rows).
        queryMock.mockResolvedValueOnce({ rows: [], },);
        const out = await reviews.create({ productId: 'p1', rating: 5, title: 'Great', }, ctx,);
        expect(createReviewMock,).toHaveBeenCalledTimes(1,);
        // Always created pending (repo defaults it; service passes no status).
        expect(out.status,).toBe('pending',);
        // Pending doesn't count → no rating recompute on create.
        expect(recomputeProductRatingMock,).not.toHaveBeenCalled();
        // verified_purchase computed from the paid-order lookup → false here.
        const createArg = createReviewMock.mock.calls[0][0] as { verifiedPurchase: boolean; };
        expect(createArg.verifiedPurchase,).toBe(false,);
    },);

    it('create marks verified_purchase when the user has a paid order for the product', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1, }], },);
        await reviews.create({ productId: 'p1', rating: 4, }, ctx,);
        const createArg = createReviewMock.mock.calls[0][0] as { verifiedPurchase: boolean; };
        expect(createArg.verifiedPurchase,).toBe(true,);
    },);

    it('moderate→approved recomputes the product rating in the txn', async () => {
        await reviews.moderate('r1', 'approved', ctx,);
        expect(updateReviewStatusMock,).toHaveBeenCalledWith('r1', 'approved', fakeClient,);
        expect(recomputeProductRatingMock,).toHaveBeenCalledWith('p1', fakeClient,);
    },);

    it('delete of an approved review recomputes the product rating', async () => {
        findReviewByIdMock.mockResolvedValue({ id: 'r1', productId: 'p1', status: 'approved', },);
        await reviews.remove('r1', ctx,);
        expect(deleteReviewMock,).toHaveBeenCalledWith('r1',);
        expect(recomputeProductRatingMock,).toHaveBeenCalledWith('p1',);
    },);

    it('delete of a pending review does NOT recompute the rating', async () => {
        findReviewByIdMock.mockResolvedValue({ id: 'r2', productId: 'p1', status: 'pending', },);
        await reviews.remove('r2', ctx,);
        expect(deleteReviewMock,).toHaveBeenCalledWith('r2',);
        expect(recomputeProductRatingMock,).not.toHaveBeenCalled();
    },);
},);
