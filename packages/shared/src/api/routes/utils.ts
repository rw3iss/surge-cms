/**
 * Wire DTOs for the /utils module — admin editor helper endpoints.
 *
 * Currently only the link-unfurl (URL preview) endpoint. It is `admin`-tier
 * because it fetches an operator-supplied arbitrary URL server-side; the
 * handler applies an SSRF guard (scheme + private/loopback/link-local IP
 * rejection) before fetching. See `packages/api/src/routes/utils.ts`.
 */

// ─── POST /utils/url-preview ──────────────────────────────────────

/** Body for POST /utils/url-preview — the page URL to unfurl. */
export interface UtilsUrlPreviewBody {
    url: string;
}

/**
 * POST /utils/url-preview — OpenGraph / basic-meta unfurl. Every field is
 * optional: the fetched page may not carry the corresponding meta tag, and
 * the admin block editor merges only the present fields into the block.
 */
export interface UtilsUrlPreviewResponse {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
}
