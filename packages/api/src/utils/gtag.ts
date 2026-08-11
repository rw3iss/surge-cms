/**
 * Google tag (gtag.js / GA4) snippet + CSP helpers.
 *
 * The operator sets a "Google Analytics ID" (a GA4 measurement id like
 * `G-XXXXXXX`) in Admin → Settings → General. When present, the SSR head
 * injector emits the standard gtag snippet on every PUBLIC page, and the CSP is
 * extended to allow the tag to load + phone home.
 *
 * The inline bootstrap body is DETERMINISTIC for a given id: the SSR injects
 * exactly `gtagInlineBody(id)` and the CSP allows exactly its sha256 hash, so
 * the two never drift and the strict `script-src` (no `'unsafe-inline'`) stays
 * intact. Both derive from THIS module — change the body here and the hash
 * follows automatically.
 */
import { createHash, } from 'crypto';

/**
 * A Google tag / GA4 measurement id (`G-…`, `GT-…`, legacy `UA-…`, Ads `AW-…`,
 * `DC-…`). Restricted to a safe charset so the value is safe to interpolate into
 * both a URL and a single-quoted JS string without escaping/injection.
 */
export function isValidGaId(id: string | null | undefined,): id is string {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id.trim(),);
}

/** Normalize an operator-entered id: trimmed, or `null` when blank/invalid. */
export function normalizeGaId(id: string | null | undefined,): string | null {
    return isValidGaId(id,) ? id.trim() : null;
}

/** The gtag inline bootstrap body (dataLayer + config). Deterministic per id. */
export function gtagInlineBody(id: string,): string {
    return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}`
        + `gtag('js',new Date());gtag('config',${JSON.stringify(id,)});`;
}

/** The full `<head>` snippet: the async loader + the inline bootstrap. */
export function gtagSnippet(id: string,): string {
    const src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id,)}`;
    return `<!-- Google tag (gtag.js) -->\n`
        + `<script async src="${src}"></script>\n`
        + `<script>${gtagInlineBody(id,)}</script>`;
}

/** CSP `script-src` source hash (`'sha256-…'`) for the inline bootstrap. */
export function gtagInlineHash(id: string,): string {
    const digest = createHash('sha256',).update(gtagInlineBody(id,), 'utf8',).digest('base64',);
    return `'sha256-${digest}'`;
}

/** Origins the gtag loader + GA4 collector fetch scripts from (`script-src`). */
export const GA_SCRIPT_ORIGINS = ['https://www.googletagmanager.com',];

/** Origins the GA4 collector sends beacons to (`connect-src`). Regional
 *  `regionN.google-analytics.com` endpoints are covered by the wildcards. */
export const GA_CONNECT_ORIGINS = [
    'https://www.googletagmanager.com',
    'https://www.google-analytics.com',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
];
