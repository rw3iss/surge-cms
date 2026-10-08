import { describe, expect, it, } from 'vitest';
import { NoVideoStreamError, parseProbe, } from './probe';

describe('parseProbe', () => {
    it('reads size, fps, codecs, duration', () => {
        const p = parseProbe({
            streams: [
                { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001', },
                { codec_type: 'audio', codec_name: 'aac', },
            ],
            format: { duration: '12.5', bit_rate: '4000000', },
        },);
        expect(p,).toMatchObject({ durationMs: 12500, displayWidth: 1920, displayHeight: 1080, fps: 29.97, hasAudio: true, audioCodec: 'aac', bitrate: 4e6, },);
    },);
    it('swaps display size for rotated phone video', () => {
        const p = parseProbe({
            streams: [{ codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90, },], },],
            format: { duration: '3', },
        },);
        expect(p.rotation,).toBe(270,);
        expect([p.displayWidth, p.displayHeight,],).toEqual([1080, 1920,],);
        expect(p.hasAudio,).toBe(false,);
    },);
    it('applies a non-square sample aspect ratio', () => {
        const p = parseProbe({ streams: [{ codec_type: 'video', width: 720, height: 480, sample_aspect_ratio: '32:27', },], format: { duration: '1', }, },);
        expect(p.displayWidth,).toBe(854,);
    },);
    it('rejects files with no (real) video stream', () => {
        expect(() => parseProbe({ streams: [{ codec_type: 'audio', },], },),).toThrow(NoVideoStreamError,);
        expect(() => parseProbe({ streams: [{ codec_type: 'video', width: 300, height: 300, disposition: { attached_pic: 1, }, },], },)).toThrow(NoVideoStreamError,);
    },);
},);
