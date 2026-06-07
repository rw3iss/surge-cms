import { beforeEach, describe, expect, it, vi, } from 'vitest';

const getMock = vi.fn();
const setMock = vi.fn();
vi.mock('./cache', () => ({
    cache: {
        get: (...a: unknown[]) => getMock(...a),
        set: (...a: unknown[]) => setMock(...a),
    },
}),);

const findPublicPostsMock = vi.fn().mockResolvedValue({ data: [], total: 0, },);
vi.mock('../repositories/posts.repo', () => ({
    findPublicPosts: (...a: unknown[]) => findPublicPostsMock(...a),
}),);

// audit eagerly imports ../db (which would try to connect); stub it out.
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);

import { listPublicCached, } from './posts';

describe('listPublicCached cache gating', () => {
    beforeEach(() => {
        getMock.mockReset();
        setMock.mockReset();
        findPublicPostsMock.mockClear();
    },);

    it('never reads or writes the public cache for admin-shaped results', async () => {
        await listPublicCached({
            filters: {}, pagination: {}, anonymous: true, isAdmin: true,
        },);
        expect(getMock,).not.toHaveBeenCalled();
        expect(setMock,).not.toHaveBeenCalled();
    },);

    it('reads and writes the public cache for genuinely anonymous reads', async () => {
        await listPublicCached({
            filters: {}, pagination: {}, anonymous: true, isAdmin: false,
        },);
        expect(getMock,).toHaveBeenCalledTimes(1,);
        expect(setMock,).toHaveBeenCalledTimes(1,);
    },);
},);
