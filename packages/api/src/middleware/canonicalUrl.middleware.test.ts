/**
 * The canonical-URL middleware's redirect rules.
 *
 * `canonicalUrl.test.ts` next door tests canonical <link> TAGS — a different
 * thing that happens to share a name. This middleware had no test at all, and
 * shipped a live open redirect: `//evil.com/` trimmed to `//evil.com`, which
 * `res.redirect` emits as a protocol-relative Location the browser follows off
 * the site. Confirmed against production before the fix.
 */
import { describe, expect, it, } from 'vitest';
import { canonicalPath, canonicalRedirect, } from './canonicalUrl';

const get = (url: string,) => canonicalRedirect('GET', url,);

describe('canonicalRedirect — open redirect guard', () => {
    it.each([
        '//evil.com/',
        '///evil.com/',
        '////evil.com/',
        '//evil.com/path/',
    ],)('refuses the protocol-relative path %j', (url,) => {
        // Trimming the trailing slash would yield `//evil.com`, and a browser
        // reads that as a network-path reference — a different ORIGIN.
        expect(get(url,),).toBeNull();
    },);

    it.each([
        '/\\evil.com/',
        '/\\\\evil.com/',
    ],)('refuses the backslash variant %j, which browsers normalise', (url,) => {
        expect(get(url,),).toBeNull();
    },);

    it('refuses anything not starting with a slash', () => {
        expect(get('http://evil.com/',),).toBeNull();
        expect(get('evil.com/',),).toBeNull();
    });

    it('never returns a target that could leave the origin', () => {
        // The property, stated once: whatever comes back is same-origin.
        for (const url of ['//a.com/', '///a.com/', '/\\a.com/', '/posts/', '/a/b/',]) {
            const t = get(url,);
            if (t === null) continue;
            expect(t.startsWith('/',),).toBe(true,);
            expect(t.startsWith('//',),).toBe(false,);
            expect(t.startsWith('/\\',),).toBe(false,);
        }
    });
});

describe('canonicalRedirect — the behaviour it is actually for', () => {
    it('still strips a trailing slash', () => {
        expect(get('/posts/',),).toBe('/posts',);
        expect(get('/a/b/c/',),).toBe('/a/b/c',);
    });

    it('strips several trailing slashes', () => {
        expect(get('/posts///',),).toBe('/posts',);
    });

    it('preserves the query string and fragment', () => {
        expect(get('/posts/?page=2',),).toBe('/posts?page=2',);
        expect(get('/posts/#top',),).toBe('/posts#top',);
    });

    it('leaves an already-canonical path alone', () => {
        expect(get('/posts',),).toBeNull();
        expect(get('/',),).toBeNull();
    });

    it('maps /index.html to /', () => {
        expect(get('/index.html',),).toBe('/',);
    });

    it('skips API and static mounts', () => {
        for (const p of ['/api/v1/posts/', '/assets/x/', '/uploads/y/', '/avatars/z/',]) {
            expect(get(p,),).toBeNull();
        }
    });

    it('only redirects safe methods', () => {
        // A 301 on a POST invites clients to replay it as a GET, losing the body.
        for (const m of ['POST', 'PUT', 'PATCH', 'DELETE',]) {
            expect(canonicalRedirect(m, '/posts/',),).toBeNull();
        }
        expect(canonicalRedirect('HEAD', '/posts/',),).toBe('/posts',);
    });
});

describe('canonicalPath', () => {
    it('never reduces a path to empty', () => {
        // `'/'` trimmed naively is `''`, which is not a valid Location.
        expect(canonicalPath('/',),).toBe('/',);
        expect(canonicalPath('///',),).toBe('/',);
    });
});
