import { mkdtempSync, } from 'node:fs';
import { tmpdir, } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, } from 'vitest';
import { imageDimensions, } from './media';

const dir = mkdtempSync(path.join(tmpdir(), 'dims-',),);

describe('imageDimensions', () => {
    it('reads an image size', async () => {
        const f = path.join(dir, 'a.png',);
        await sharp({ create: { width: 40, height: 20, channels: 3, background: '#f00', }, },).png().toFile(f,);
        expect(await imageDimensions(f, 'image/png',),).toEqual({ width: 40, height: 20, },);
    },);
    it('applies EXIF rotation (portrait phone photo stored landscape)', async () => {
        const f = path.join(dir, 'r.jpg',);
        await sharp({ create: { width: 40, height: 20, channels: 3, background: '#0f0', }, },).jpeg().withMetadata({ orientation: 6, },).toFile(f,);
        expect(await imageDimensions(f, 'image/jpeg',),).toEqual({ width: 20, height: 40, },);
    },);
    it('null for non-images and unreadable files', async () => {
        expect(await imageDimensions(path.join(dir, 'a.png',), 'video/mp4',),).toBeNull();
        expect(await imageDimensions(path.join(dir, 'missing.png',), 'image/png',),).toBeNull();
    },);
},);
