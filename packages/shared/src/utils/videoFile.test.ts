import { describe, expect, it, } from 'vitest';
import { isVideoFile, videoMimeFor, } from './videoFile';

describe('videoMimeFor', () => {
    it('keeps a video/* type', () => expect(videoMimeFor('a.bin', 'video/mp4',),).toBe('video/mp4',));
    it('uses the extension when the type is empty or generic', () => {
        expect(videoMimeFor('clip.MKV', '',),).toBe('video/x-matroska',);
        expect(videoMimeFor('clip.mov', 'application/octet-stream',),).toBe('video/quicktime',);
    },);
    it('a real non-video type wins over the extension', () => expect(isVideoFile('x.mp4', 'image/png',),).toBe(false,));
    it('non-video files', () => expect(isVideoFile('doc.pdf', '',),).toBe(false,));
},);
