import { describe, expect, it, } from 'vitest';
import { encodeArgs, hlsPackageArgs, lowPriority, posterArgs, quickReplayArgs, remuxArgs, spriteArgs, spriteSheetCount, spriteVtt, teaserCutArgs, } from './ffmpegArgs';
import { selectRungs, } from './ladder';

const rung = selectRungs([{ name: '720p', height: 720, maxrateKbps: 2800, audioKbps: 128, enabled: true, },], 1920, 1080, 30,)[0];
const after = (a: string[], flag: string,) => a[a.indexOf(flag,) + 1];

describe('lowPriority', () => {
    it('wraps in nice + ionice when available', () => {
        expect(lowPriority('ffmpeg', ['-i', 'x',], { nice: true, ionice: true, },),).toEqual({
            cmd: 'nice', args: ['-n', '19', 'ionice', '-c3', 'ffmpeg', '-i', 'x',],
        },);
        expect(lowPriority('ffmpeg', ['-i', 'x',], { nice: false, ionice: true, },),).toEqual({ cmd: 'ionice', args: ['-c3', 'ffmpeg', '-i', 'x',], },);
        expect(lowPriority('ffmpeg', ['-i', 'x',], { nice: false, ionice: false, },),).toEqual({ cmd: 'ffmpeg', args: ['-i', 'x',], },);
    },);
},);

describe('encodeArgs', () => {
    const a = encodeArgs({ input: 'in.mov', output: 'out.mp4', rung, threads: 2, preset: 'veryfast', crf: 21, segmentSeconds: 6, },);
    it('encodes H.264/AAC with keyframes on the segment grid', () => {
        expect(after(a, '-c:v',),).toBe('libx264',);
        expect(after(a, '-vf',),).toBe('scale=1280:720:flags=bicubic,setsar=1,format=yuv420p',);
        expect(after(a, '-force_key_frames',),).toBe('expr:gte(t,n_forced*6)',);
        expect(after(a, '-sc_threshold',),).toBe('0',);
        expect(after(a, '-maxrate',),).toBe('2800k',);
        expect(after(a, '-bufsize',),).toBe('5600k',);
        expect(after(a, '-threads',),).toBe('2',);
        expect(after(a, '-filter_threads',),).toBe('1',);
        expect(after(a, '-movflags',),).toBe('+faststart',);
        expect(after(a, '-progress',),).toBe('pipe:1',);
        expect(a.at(-1,),).toBe('out.mp4',);
    },);
},);

describe('hlsPackageArgs', () => {
    it('stream-copies to VOD TS; key info only when encrypted', () => {
        const plain = hlsPackageArgs({ input: 'r.mp4', dir: '/t/720p', segmentSeconds: 6, },);
        expect(after(plain, '-c',),).toBe('copy',);
        expect(after(plain, '-hls_playlist_type',),).toBe('vod',);
        expect(after(plain, '-hls_segment_filename',),).toBe('/t/720p/seg_%05d.ts',);
        expect(plain,).not.toContain('-hls_key_info_file',);
        expect(plain.at(-1,),).toBe('/t/720p/index.m3u8',);
        const enc = hlsPackageArgs({ input: 'r.mp4', dir: '/t/720p', segmentSeconds: 6, keyInfoFile: '/t/key.info', },);
        expect(after(enc, '-hls_key_info_file',),).toBe('/t/key.info',);
        expect(hlsPackageArgs({ input: 'r.mp4', dir: 'd', segmentSeconds: 6, keyInfoFile: null, },),).not.toContain('-hls_key_info_file',);
    },);
},);

describe('teaser / poster / sprites', () => {
    it('teaser cut seeks on input and copies', () => {
        const a = teaserCutArgs({ input: 'r.mp4', output: 't.mp4', startSec: 30, durationSec: 60, },);
        expect(a.indexOf('-ss',),).toBeLessThan(a.indexOf('-i',),);
        expect(after(a, '-ss',),).toBe('30',);
        expect(after(a, '-t',),).toBe('60',);
        expect(after(a, '-c',),).toBe('copy',);
        expect(a,).not.toContain('-hls_key_info_file',);
    },);
    it('poster writes one frame', () => {
        const a = posterArgs({ input: 's.mp4', output: 'p.jpg', atSec: -1, },);
        expect(after(a, '-ss',),).toBe('0',);
        expect(after(a, '-frames:v',),).toBe('1',);
        expect(a,).toContain('-update',);
    },);
    it('sprites tile 10x10 every 10 s', () => {
        expect(after(spriteArgs({ input: 'r.mp4', dir: '/d', },), '-vf',),).toBe('fps=1/10,scale=160:-2,tile=10x10',);
        expect(spriteSheetCount(5,),).toBe(1,);
        expect(spriteSheetCount(1000,),).toBe(1,);
        expect(spriteSheetCount(1001,),).toBe(2,);
    },);
},);

describe('spriteVtt', () => {
    it('emits one cue per 10 s with absolute URLs and #xywh', () => {
        const vtt = spriteVtt({ durationSec: 25, tileWidth: 160, tileHeight: 90, spriteUrl: (n,) => `https://cdn/x/sprite_${n}.jpg`, },);
        const lines = vtt.split('\n',);
        expect(lines[0],).toBe('WEBVTT',);
        expect(vtt,).toContain('00:00:00.000 --> 00:00:10.000\nhttps://cdn/x/sprite_1.jpg#xywh=0,0,160,90',);
        expect(vtt,).toContain('00:00:10.000 --> 00:00:20.000\nhttps://cdn/x/sprite_1.jpg#xywh=160,0,160,90',);
        expect(vtt,).toContain('00:00:20.000 --> 00:00:25.000\nhttps://cdn/x/sprite_1.jpg#xywh=320,0,160,90',);
        expect(vtt.match(/-->/g,),).toHaveLength(3,);
    },);
    it('wraps rows and sheets', () => {
        const vtt = spriteVtt({ durationSec: 1010, tileWidth: 160, tileHeight: 90, spriteUrl: (n,) => `s${n}`, },);
        expect(vtt,).toContain('00:01:40.000 --> 00:01:50.000\ns1#xywh=0,90,160,90',);
        expect(vtt,).toContain('00:16:40.000 --> 00:16:50.000\ns2#xywh=0,0,160,90',);
    },);
},);
describe('quick replay / remux', () => {
    it('copies video, converts audio to AAC, faststart MP4', () => {
        const a = quickReplayArgs({ input: 'in.webm', output: 'out.mp4', hasAudio: true, },);
        expect(a.join(' ',),).toContain('-c:v copy',);
        expect(a.join(' ',),).toContain('-c:a aac',);
        expect(a.join(' ',),).toContain('-movflags +faststart',);
        expect(a.at(-1,),).toBe('out.mp4',);
    },);
    it('skips the audio map when there is no audio', () => {
        expect(quickReplayArgs({ input: 'i', output: 'o', hasAudio: false, },).join(' ',),).not.toContain('0:a:0',);
    },);
    it('remux is a pure stream copy into matroska', () => {
        const a = remuxArgs({ input: 'i.webm', output: 'o.mkv', },).join(' ',);
        expect(a,).toContain('-c copy',);
        expect(a,).toContain('-f matroska',);
    },);
},);

