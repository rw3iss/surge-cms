/** C1: the S3 provider maps a stored thumbnail URL back to its key (and only an uploads/ key). */
import { describe, expect, it, } from 'vitest';
import { S3StorageProvider, } from './s3';

const p = new S3StorageProvider({ bucket: 'b', region: 'auto', cdnUrl: 'https://cdn.test/', endpoint: 'https://acct.r2.test', } as never,);

describe('S3StorageProvider.keyFromUrl', () => {
    it('maps a CDN URL to its uploads/ key', () => {
        expect(p.keyFromUrl('https://cdn.test/uploads/thumb_v3_abc.png',),).toBe('uploads/thumb_v3_abc.png',);
        expect(p.keyFromUrl('https://cdn.test/uploads/thumb_v3_abc.jpg?v=2',),).toBe('uploads/thumb_v3_abc.jpg',);
    });
    it('refuses foreign hosts, other prefixes and traversal', () => {
        expect(p.keyFromUrl('https://evil.test/uploads/x.png',),).toBeNull();
        expect(p.keyFromUrl('https://cdn.test/video/x/master.m3u8',),).toBeNull();
        expect(p.keyFromUrl('https://cdn.test/uploads/../video/x',),).toBeNull();
        expect(p.keyFromUrl('/uploads/x.png',),).toBeNull();
    });
});
