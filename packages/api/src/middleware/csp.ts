/**
 * Plugin-aware Content-Security-Policy.
 *
 * The base CSP (same directives helmet applied before) is extended at
 * runtime with origins that ENABLED plugins need — chiefly `connect-src`
 * for a widget that talks to its own backend (e.g. PageLoop → its RPC
 * endpoint). Extra origins come from two sources, computed by the plugins
 * service and pushed here via `setPluginCspOrigins`:
 *   1. `type:'url'` config values of enabled plugins → connect-src.
 *   2. A plugin manifest's optional `csp` block (static origins).
 *
 * We wrap helmet's CSP middleware and rebuild it when the plugin origin
 * set changes, so helmet still supplies its secure defaults (base-uri,
 * object-src 'none', frame-ancestors, upgrade-insecure-requests, …).
 */
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { GA_CONNECT_ORIGINS, GA_SCRIPT_ORIGINS, gtagInlineHash, normalizeGaId, } from '../utils/gtag';

export interface PluginCspOrigins {
    connectSrc: string[];
    scriptSrc: string[];
    styleSrc: string[];
    imgSrc: string[];
    frameSrc: string[];
}

const EMPTY: PluginCspOrigins = { connectSrc: [], scriptSrc: [], styleSrc: [], imgSrc: [], frameSrc: [] };

// Video / social embeds the CMS renders as <iframe>: the social block embeds
// YouTube (`www.youtube.com/embed/…`), and the video block embeds arbitrary
// YouTube/Vimeo URLs. Without these in frame-src the browser shows the embed as
// "This content is blocked. Contact the site owner to fix the issue."
const EMBED_FRAME_SRC = [
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
];

let pluginOrigins: PluginCspOrigins = EMPTY;

// Operator's Google tag / GA4 measurement id (Admin → Settings → General), or
// null when unset. When set, the tag's origins + the deterministic sha256 of the
// SSR-injected inline bootstrap join the CSP so the tag loads + beacons under the
// strict script-src. Kept in sync by `services/analyticsCsp.syncAnalyticsCsp`.
let analyticsGaId: string | null = null;

/** GA additions to `script-src`: the loader origin + the inline bootstrap hash. */
function analyticsScriptSrc(): string[] {
    return analyticsGaId ? [...GA_SCRIPT_ORIGINS, gtagInlineHash(analyticsGaId,)] : [];
}

/** GA additions to `connect-src`: the collector beacon endpoints. */
function analyticsConnectSrc(): string[] {
    return analyticsGaId ? [...GA_CONNECT_ORIGINS] : [];
}

function buildDirectives(): Record<string, string[]> {
    return {
        defaultSrc: ["'self'"],
        // fonts.googleapis.com: the appearance system loads Google Fonts
        // stylesheets; the gstatic font files are already covered by the
        // default font-src ('self' https: data:).
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...pluginOrigins.styleSrc],
        // js.stripe.com must be in script-src (not just frame-src): the built-in
        // Stripe donation / subscription / shop-checkout forms load Stripe.js as a
        // SCRIPT. Core feature → always allowed, independent of any plugin.
        // Google tag (gtag.js) origins + the inline-bootstrap hash are added when
        // an Analytics ID is configured.
        scriptSrc: ["'self'", 'https://js.stripe.com', ...analyticsScriptSrc(), ...pluginOrigins.scriptSrc],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', ...pluginOrigins.imgSrc],
        connectSrc: ["'self'", 'https://api.stripe.com', ...analyticsConnectSrc(), ...pluginOrigins.connectSrc],
        // js.stripe.com (Elements) + hooks.stripe.com (3-D Secure / redirects).
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', ...EMBED_FRAME_SRC, ...pluginOrigins.frameSrc],
    };
}

// The current helmet CSP instance; rebuilt when plugin origins change.
let cspMiddleware: RequestHandler = helmet.contentSecurityPolicy({ directives: buildDirectives() });

/** Set (or clear) the Google tag id in the CSP and rebuild the middleware.
 *  No-op when unchanged. `null`/invalid removes the GA sources. */
export function setAnalyticsGaId(id: string | null | undefined): void {
    const clean = normalizeGaId(id);
    if (clean === analyticsGaId) return;
    analyticsGaId = clean;
    cspMiddleware = helmet.contentSecurityPolicy({ directives: buildDirectives() });
}

/** Replace the plugin-contributed CSP origins and rebuild the middleware. */
export function setPluginCspOrigins(origins: Partial<PluginCspOrigins>): void {
    pluginOrigins = {
        connectSrc: dedupe(origins.connectSrc),
        scriptSrc: dedupe(origins.scriptSrc),
        styleSrc: dedupe(origins.styleSrc),
        imgSrc: dedupe(origins.imgSrc),
        frameSrc: dedupe(origins.frameSrc),
    };
    cspMiddleware = helmet.contentSecurityPolicy({ directives: buildDirectives() });
}

function dedupe(v?: string[]): string[] {
    return v ? [...new Set(v.filter(Boolean))] : [];
}

/** Delegates to the current (rebuildable) helmet CSP middleware. */
export const pluginAwareCsp: RequestHandler = (req, res, next) => cspMiddleware(req, res, next);
