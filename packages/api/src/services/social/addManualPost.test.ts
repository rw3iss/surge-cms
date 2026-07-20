import { beforeEach, describe, expect, it, vi, } from 'vitest';

// Mock the DB + hydration so we exercise addManualPost without network/DB.
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('./twitterHydrate', async (orig,) => {
    const actual = await orig<typeof import('./twitterHydrate')>();
    return { ...actual, fetchTweetById: vi.fn(), };
},);

import { query, } from '../../db';
import { addManualPost, } from '../social';
import { fetchTweetById, } from './twitterHydrate';

const q = query as unknown as ReturnType<typeof vi.fn>;
const fetchTweet = fetchTweetById as unknown as ReturnType<typeof vi.fn>;

describe('addManualPost', () => {
    beforeEach(() => {
        q.mockReset();
        fetchTweet.mockReset();
    },);

    it('rejects a non-status URL', async () => {
        await expect(addManualPost('https://x.com/foo',),).rejects.toThrow(/Unrecognized post URL/,);
        expect(q,).not.toHaveBeenCalled();
    },);

    it('hydrates + upserts a valid tweet URL as source=manual', async () => {
        fetchTweet.mockResolvedValue({
            id: '99',
            content: 'hi',
            thumbnailUrl: 'https://pbs.twimg.com/a.jpg',
            publishedAt: new Date(0,),
            rawData: {},
        },);
        q.mockResolvedValueOnce({ rows: [], },); // upsert INSERT
        q.mockResolvedValueOnce({ // final SELECT
            rows: [{
                id: 'uuid-1', platform: 'twitter', external_id: '99', content: 'hi',
                source: 'manual', post_url: 'https://x.com/foo/status/99', is_hidden: false, sort_order: 0,
            },],
        },);

        const post = await addManualPost('https://x.com/foo/status/99', 'user-1',);

        expect(post.source,).toBe('manual',);
        expect(post.externalId,).toBe('99',);
        // First query call is the upsert; assert 'manual' provenance was passed.
        const insertParams = q.mock.calls[0][1] as unknown[];
        expect(insertParams,).toContain('manual',);
        expect(insertParams,).toContain('user-1',);
    },);

    it('still stores a minimal row when hydration fails', async () => {
        fetchTweet.mockResolvedValue(null,);
        q.mockResolvedValueOnce({ rows: [], },);
        q.mockResolvedValueOnce({
            rows: [{ id: 'uuid-2', platform: 'twitter', external_id: '42', source: 'manual', is_hidden: false, sort_order: 0, },],
        },);

        const post = await addManualPost('https://x.com/bar/status/42',);
        expect(post.externalId,).toBe('42',);
        expect(fetchTweet,).toHaveBeenCalledWith('42',);
    },);
},);
