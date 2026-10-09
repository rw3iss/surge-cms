import { describe, expect, it, } from 'vitest';
import { findCue, parseThumbnailsVtt, parseVttTime, } from './vtt';

const VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000
sprite.jpg#xywh=0,0,160,90

1
00:00:05.000 --> 00:00:10.000
sprite.jpg#xywh=pixel:160,0,160,90

00:10.000 --> 00:15.000
https://cdn.example.com/full.jpg
`;

describe('vtt thumbnails', () => {
    it('parses timestamps', () => {
        expect(parseVttTime('00:01:02.500',),).toBe(62.5,);
        expect(parseVttTime('01:02,250',),).toBe(62.25,);
        expect(parseVttTime('bad',),).toBeNaN();
    },);

    it('parses cues with xywh crops and resolves URLs against the VTT', () => {
        const cues = parseThumbnailsVtt(VTT, 'https://site.test/media/abc/thumbs.vtt',);
        expect(cues,).toHaveLength(3,);
        expect(cues[0],).toEqual({ start: 0, end: 5, url: 'https://site.test/media/abc/sprite.jpg', x: 0, y: 0, w: 160, h: 90, },);
        expect(cues[1].x,).toBe(160,);
        expect(cues[2],).toMatchObject({ start: 10, url: 'https://cdn.example.com/full.jpg', w: 0, },);
    },);

    it('finds the cue covering a time', () => {
        const cues = parseThumbnailsVtt(VTT, 'https://site.test/t.vtt',);
        expect(findCue(cues, 0,)?.x,).toBe(0,);
        expect(findCue(cues, 7.2,)?.x,).toBe(160,);
        expect(findCue(cues, 99,)?.w,).toBe(0,);
        expect(findCue([], 1,),).toBeNull();
    },);
},);
