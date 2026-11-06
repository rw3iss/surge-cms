import { describe, expect, it, } from 'vitest';
import {
    ageOrder, audienceHasData, bestHours, countryName, flagEmoji, fullDay, hourLabel, invalidUsernames, kindsPresent,
    missingNote, parseUsernames, sortHashtags, topN, typeLabel, withShares,
} from './audienceFormat';

const b = (key: string, value: number,) => ({ key, value, share: 0, });

describe('audience shares + ordering', () => {
    it('recomputes shares, drops empty buckets, sorts by size', () => {
        const r = withShares([b('US', 30,), b('CA', 10,), b('X', 0,),],);
        expect(r.map((x,) => x.key),).toEqual(['US', 'CA',],);
        expect(r[0].share,).toBeCloseTo(0.75,);
        expect(r[1].share,).toBeCloseTo(0.25,);
    },);

    it('top N keeps shares of the whole breakdown', () => {
        const r = topN([b('a', 50,), b('b', 30,), b('c', 20,),], 2,);
        expect(r.map((x,) => x.key),).toEqual(['a', 'b',],);
        expect(r[1].share,).toBeCloseTo(0.3,);
    },);

    it('orders age bands naturally', () => {
        expect(ageOrder([b('65+', 1,), b('18-24', 5,), b('13-17', 2,), b('25-34', 9,),],).map((x,) => x.key),).toEqual(['13-17', '18-24', '25-34', '65+',],);
    },);
},);

describe('best hours', () => {
    it('ranks hours by followers online, ties by earlier hour', () => {
        const hours = [{ hour: 9, value: 50, }, { hour: 20, value: 80, }, { hour: 13, value: 50, }, { hour: 2, value: 0, },];
        expect(bestHours(hours, 3,),).toEqual([20, 9, 13,],);
    },);

    it('fills all 24 hours and labels them', () => {
        const day = fullDay([{ hour: 5, value: 3, },],);
        expect(day,).toHaveLength(24,);
        expect(day[5].value,).toBe(3,);
        expect(day[6].value,).toBe(0,);
        expect([hourLabel(0,), hourLabel(12,), hourLabel(13,),],).toEqual(['12 AM', '12 PM', '1 PM',],);
    },);
},);

describe('labels', () => {
    it('country flags + names, content types', () => {
        expect(flagEmoji('us',),).toBe('🇺🇸',);
        expect(flagEmoji('Mexico City',),).toBe('',);
        expect(countryName('US',),).toBe('United States',);
        expect(typeLabel('REEL',),).toBe('Reels',);
        expect(typeLabel('CAROUSEL_ALBUM',),).toBe('Carousels',);
    },);

    it('lists post kinds present, known ones first in a fixed order', () => {
        expect(kindsPresent(['video', 'STORY', null, 'reel', 'podcast', 'reel',],),).toEqual(['reel', 'story', 'video', 'podcast',],);
    },);
},);

describe('hashtags + usernames', () => {
    const rows = [
        { tag: 'nyc', posts: 3, avgViews: 100, engagementRate: 0.05, },
        { tag: 'protest', posts: 1, avgViews: 500, engagementRate: null, },
        { tag: 'art', posts: 2, avgViews: null, engagementRate: 0.1, },
    ];
    it('sorts with nulls last either way', () => {
        expect(sortHashtags(rows, 'avgViews', 'desc',).map((r,) => r.tag),).toEqual(['protest', 'nyc', 'art',],);
        expect(sortHashtags(rows, 'avgViews', 'asc',).map((r,) => r.tag),).toEqual(['nyc', 'protest', 'art',],);
        expect(sortHashtags(rows, 'tag', 'asc',).map((r,) => r.tag),).toEqual(['art', 'nyc', 'protest',],);
    },);

    it('parses and validates Instagram usernames', () => {
        expect(parseUsernames('@NYTimes, cnn\nhttps://www.instagram.com/bbcnews/ nytimes',),).toEqual(['nytimes', 'cnn', 'bbcnews',],);
        expect(invalidUsernames(['ok.name_1', 'bad-name', 'x'.repeat(31,),],),).toEqual(['bad-name', 'x'.repeat(31,),],);
    },);
},);

describe('empty states', () => {
    it('explains missing blocks from capabilities', () => {
        expect(missingNote('demographics', { demographics: false, },),).toMatch(/Business or Creator/,);
        expect(missingNote('demographics', null,),).toMatch(/No demographics/,);
        expect(missingNote('benchmarks', { benchmarks: false, },),).toMatch(/Facebook-Login/,);
    },);

    it('detects whether an audience has anything to show', () => {
        const empty = {
            platform: 'instagram', from: '2026-11-01', to: '2026-11-07', asOf: null,
            demographics: { followers: null, engaged: null, reached: null, },
            onlineHours: [], breakdowns: { viewsByType: [], reachByType: [], interactionsByType: [], viewsByFollow: [], reachByFollow: [], },
            contentKinds: [], hashtags: [], stories: { count: 0, views: null, reach: null, replies: null, }, benchmarks: [], capabilities: null,
        };
        expect(audienceHasData(empty,),).toBe(false,);
        expect(audienceHasData({ ...empty, onlineHours: [{ hour: 3, value: 4, },], },),).toBe(true,);
    },);
},);
