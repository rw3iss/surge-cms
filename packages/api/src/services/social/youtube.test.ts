import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], },), }),);

const { classifyVideo, isChannelId, parseIsoDuration, } = await import('./youtube');

/**
 * Classification is the whole point of the second API call — if it is wrong,
 * "Shorts" in the block picker silently shows full videos.
 */
describe('parseIsoDuration', () => {
    it.each([
        ['PT45S', 45,],
        ['PT1M', 60,],
        ['PT1M5S', 65,],
        ['PT1H2M3S', 3723,],
        ['P1DT1H', 90000,],
        ['PT0S', 0,],
    ],)('%s → %i seconds', (iso, expected,) => {
        expect(parseIsoDuration(iso,),).toBe(expected,);
    },);

    it('returns null for junk rather than a misleading zero', () => {
        expect(parseIsoDuration('banana',),).toBeNull();
        expect(parseIsoDuration('',),).toBeNull();
        expect(parseIsoDuration(undefined,),).toBeNull();
    },);
},);

describe('classifyVideo', () => {
    it('calls a 60s video a short', () => {
        expect(classifyVideo({ contentDetails: { duration: 'PT60S', }, },),).toBe('short',);
    });

    it('calls a 1-2 minute clip a short — YouTube raised the ceiling to 3 min', () => {
        // Regression: a 60s cut-off reported a whole Shorts channel as videos.
        expect(classifyVideo({ contentDetails: { duration: 'PT1M1S', }, },),).toBe('short',);
        expect(classifyVideo({ contentDetails: { duration: 'PT1M38S', }, },),).toBe('short',);
        expect(classifyVideo({ contentDetails: { duration: 'PT2M10S', }, },),).toBe('short',);
    });

    it('puts the boundary at 3 minutes inclusive', () => {
        expect(classifyVideo({ contentDetails: { duration: 'PT3M', }, },),).toBe('short',);
        expect(classifyVideo({ contentDetails: { duration: 'PT3M1S', }, },),).toBe('video',);
    });

    it('calls a long video a video', () => {
        expect(classifyVideo({ contentDetails: { duration: 'PT12M30S', }, },),).toBe('video',);
        expect(classifyVideo({ contentDetails: { duration: 'PT6M27S', }, },),).toBe('video',);
    });

    it('treats an in-progress broadcast as live', () => {
        expect(classifyVideo({ snippet: { liveBroadcastContent: 'live', }, },),).toBe('live',);
    });

    it('treats an upcoming broadcast as live', () => {
        expect(classifyVideo({ snippet: { liveBroadcastContent: 'upcoming', }, },),).toBe('live',);
    });

    it('treats a finished stream as live, not a video', () => {
        // A past broadcast keeps liveStreamingDetails; that is what makes it
        // distinguishable from an ordinary upload of the same length.
        expect(classifyVideo({
            contentDetails: { duration: 'PT2H', },
            liveStreamingDetails: { actualEndTime: '2026-01-01T00:00:00Z', },
            snippet: { liveBroadcastContent: 'none', },
        },),).toBe('live',);
    });

    it('live wins over a short duration', () => {
        expect(classifyVideo({
            contentDetails: { duration: 'PT30S', },
            liveStreamingDetails: {},
        },),).toBe('live',);
    });

    it('defaults to video when duration is missing', () => {
        // Better a plain video than a wrong "short" — the picker's Shorts
        // filter must not fill up with unclassifiable items.
        expect(classifyVideo({},),).toBe('video',);
        expect(classifyVideo({ contentDetails: {}, },),).toBe('video',);
    });

    it('does not call a zero-length video a short', () => {
        expect(classifyVideo({ contentDetails: { duration: 'PT0S', }, },),).toBe('video',);
    });
},);

describe('isChannelId', () => {
    it('accepts a real channel id', () => {
        expect(isChannelId('UC1s0XOR5JHrnlfThwG3lVJA',),).toBe(true,);
    },);

    it('rejects the handle people actually paste', () => {
        // This is the whole point: a handle fed to search.list?channelId=
        // returns nothing at all, with no error.
        expect(isChannelId('frank.scales',),).toBe(false,);
        expect(isChannelId('@frank.scales',),).toBe(false,);
    },);

    it('rejects a UC-prefixed string of the wrong length', () => {
        expect(isChannelId('UCtoolshort',),).toBe(false,);
        expect(isChannelId('UC1s0XOR5JHrnlfThwG3lVJAextra',),).toBe(false,);
    },);
},);
