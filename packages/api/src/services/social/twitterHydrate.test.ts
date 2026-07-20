import { describe, expect, it, } from 'vitest';
import { deriveTweetToken, mapTweetResultToFetchedPost, parseTweetUrl, } from './twitterHydrate';

describe('deriveTweetToken', () => {
    it('is deterministic and only base-36 chars (no zeros/dot)', () => {
        const t = deriveTweetToken('1234567890123456789',);
        expect(t,).toMatch(/^[0-9a-z]+$/,);
        expect(t,).not.toContain('.',);
        expect(deriveTweetToken('1234567890123456789',),).toBe(t,);
    },);
},);

describe('parseTweetUrl', () => {
    it('extracts id + handle from x.com and twitter.com', () => {
        expect(parseTweetUrl('https://x.com/foo/status/1799000000000000001',),).toEqual({
            id: '1799000000000000001',
            handle: 'foo',
            url: 'https://x.com/foo/status/1799000000000000001',
        },);
        expect(parseTweetUrl('twitter.com/bar/status/42?s=20',)?.id,).toBe('42',);
        expect(parseTweetUrl('http://www.x.com/baz/status/7',)?.handle,).toBe('baz',);
    },);

    it('returns null for non-status URLs', () => {
        expect(parseTweetUrl('https://x.com/foo',),).toBeNull();
        expect(parseTweetUrl('https://example.com/a/status/1',),).toBeNull();
        expect(parseTweetUrl('not a url',),).toBeNull();
    },);
},);

describe('mapTweetResultToFetchedPost', () => {
    it('maps text, author, media, metrics', () => {
        const json = {
            id_str: '99',
            text: 'hello world',
            user: { name: 'Foo', screen_name: 'foo', profile_image_url_https: 'https://pbs.twimg.com/a.jpg', },
            created_at: 'Wed Jun 05 12:00:00 +0000 2024',
            favorite_count: 3,
            conversation_count: 1,
            mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/media/x.jpg', type: 'photo', },],
        };
        const p = mapTweetResultToFetchedPost(json,);
        expect(p.id,).toBe('99',);
        expect(p.content,).toBe('hello world',);
        expect(p.authorName,).toBe('Foo',);
        expect(p.authorAvatar,).toContain('pbs.twimg.com',);
        expect(p.thumbnailUrl,).toBe('https://pbs.twimg.com/media/x.jpg',);
        expect(p.mediaUrl,).toBe('https://x.com/foo/status/99',);
        expect(p.likes,).toBe(3,);
        expect(p.comments,).toBe(1,);
        expect(p.publishedAt,).toBeInstanceOf(Date,);
    },);

    it('tolerates missing optional fields', () => {
        const p = mapTweetResultToFetchedPost({ id_str: '1', text: 't', },);
        expect(p.id,).toBe('1',);
        expect(p.thumbnailUrl,).toBeUndefined();
        expect(p.likes,).toBeUndefined();
    },);
},);
