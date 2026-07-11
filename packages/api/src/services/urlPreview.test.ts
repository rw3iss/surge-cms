import { beforeEach, describe, expect, it, vi, } from 'vitest';

// Mock dns.lookup so the SSRF resolution step is deterministic. The service
// promisifies `dns.lookup`, so the mock must call back node-style.
const lookupImpl = vi.fn();
vi.mock('node:dns', () => ({
    default: {
        lookup: (host: string, opts: unknown, cb: (err: Error | null, res?: unknown,) => void,) => {
            // promisify calls the (host, opts, cb) arity when opts is passed.
            const callback = typeof opts === 'function' ? opts as typeof cb : cb;
            try {
                const result = lookupImpl(host,);
                callback(null, result,);
            } catch (err) {
                callback(err as Error,);
            }
        },
    },
}),);

import { fetchUrlPreview, isPrivateIp, parsePreview, } from './urlPreview';
import { ValidationError, } from '../core/errors';

describe('isPrivateIp', () => {
    it('flags loopback / private / link-local / metadata ranges', () => {
        for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',]) {
            expect(isPrivateIp(ip,), ip,).toBe(true,);
        }
    });

    it('allows normal public addresses', () => {
        for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111',]) {
            expect(isPrivateIp(ip,), ip,).toBe(false,);
        }
    },);
},);

describe('parsePreview', () => {
    it('extracts OpenGraph and basic meta', () => {
        const html = `<html><head>
            <title>Fallback Title</title>
            <meta property="og:title" content="OG Title" />
            <meta name="description" content="A &amp; B description" />
            <meta property="og:image" content="https://x/img.png" />
            <meta property="og:site_name" content="Example Site" />
        </head></html>`;
        expect(parsePreview(html,),).toEqual({
            title: 'OG Title',
            description: 'A & B description',
            image: 'https://x/img.png',
            siteName: 'Example Site',
        },);
    },);

    it('falls back to <title> when og:title is absent', () => {
        expect(parsePreview('<title>Just Title</title>',),).toEqual({ title: 'Just Title', },);
    },);
},);

describe('fetchUrlPreview SSRF guard', () => {
    beforeEach(() => lookupImpl.mockReset(),);

    it('rejects localhost before any fetch', async () => {
        await expect(fetchUrlPreview('http://localhost/admin',),).rejects.toBeInstanceOf(ValidationError,);
        expect(lookupImpl,).not.toHaveBeenCalled();
    },);

    it('rejects a host that resolves to a private IP', async () => {
        lookupImpl.mockReturnValue([{ address: '169.254.169.254', family: 4, },],);
        await expect(fetchUrlPreview('http://metadata.internal/latest',),).rejects.toBeInstanceOf(ValidationError,);
    },);

    it('rejects a non-http(s) scheme', async () => {
        await expect(fetchUrlPreview('file:///etc/passwd',),).rejects.toBeInstanceOf(ValidationError,);
    },);
},);
