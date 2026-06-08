/**
 * Route-coverage registry — the COMPLETENESS GUARANTEE for the client.
 *
 * `ROUTE_COVERAGE` lists one `"<METHOD> <absolutePath>"` entry per client
 * method, using the SAME absolutePath form the API manifest emits
 * (`docs/api-manifest.json`): `/api/v1`-prefixed for JSON routes, root-mounted
 * for raw routes (`/feed.xml`, `/sitemap.xml`, `/admin/sitemap/regenerate`),
 * `:param` tokens preserved.
 *
 * `INTENTIONALLY_UNEXPOSED` is the allowlist of manifest routes the client
 * deliberately does NOT surface (server-internal redirects / raw HTML / Stripe
 * webhook). Every manifest route MUST appear in exactly one of the two sets;
 * `scripts/check-drift.ts` asserts this in both directions.
 */

/** Every route a `cms.<module>.<method>()` call hits, in manifest form. */
export const ROUTE_COVERAGE: string[] = [
    // ── posts ──
    'GET /api/v1/posts',
    'GET /api/v1/posts/search',
    'GET /api/v1/posts/slug/:slug',
    'GET /api/v1/posts/:id',
    'POST /api/v1/posts',
    'PUT /api/v1/posts/:id',
    'DELETE /api/v1/posts/:id',
    'POST /api/v1/posts/bulk',
    'GET /api/v1/posts/:id/revisions',
    'GET /api/v1/posts/:id/revisions/:version',
    'POST /api/v1/posts/:id/revisions/:version/restore',
    'PUT /api/v1/posts/:id/blocks/reorder',

    // ── pages ──
    'GET /api/v1/pages/navigation',
    'GET /api/v1/pages/homepage',
    'GET /api/v1/pages/slug/:slug',
    'GET /api/v1/pages',
    'GET /api/v1/pages/:id',
    'POST /api/v1/pages',
    'PUT /api/v1/pages/:id',
    'DELETE /api/v1/pages/:id',
    'POST /api/v1/pages/bulk',
    'GET /api/v1/pages/:id/revisions',
    'GET /api/v1/pages/:id/revisions/:version',
    'POST /api/v1/pages/:id/revisions/:version/restore',
    'POST /api/v1/pages/:pageId/blocks',
    'PUT /api/v1/pages/:pageId/blocks/:blockId',
    'DELETE /api/v1/pages/:pageId/blocks/:blockId',
    'PUT /api/v1/pages/:pageId/blocks/reorder',

    // ── campaigns ──
    'GET /api/v1/campaigns',
    'GET /api/v1/campaigns/slug/:slug',
    'GET /api/v1/campaigns/:id/donations',
    'GET /api/v1/campaigns/donations/summary',
    'GET /api/v1/campaigns/donations/all',
    'GET /api/v1/campaigns/:id',
    'POST /api/v1/campaigns',
    'PUT /api/v1/campaigns/:id',
    'DELETE /api/v1/campaigns/:id',
    'POST /api/v1/campaigns/bulk',

    // ── forms ──
    'GET /api/v1/forms',
    'GET /api/v1/forms/slug/:slug',
    'GET /api/v1/forms/slug/:slug/results',
    'POST /api/v1/forms/slug/:slug/submit',
    'GET /api/v1/forms/:id',
    'GET /api/v1/forms/:id/submissions',
    'GET /api/v1/forms/:id/submissions/export',
    'POST /api/v1/forms',
    'PUT /api/v1/forms/:id',
    'DELETE /api/v1/forms/:id',
    'POST /api/v1/forms/bulk',
    'POST /api/v1/forms/:id/questions',
    'PUT /api/v1/forms/:formId/questions/:questionId',
    'DELETE /api/v1/forms/:formId/questions/:questionId',

    // ── media ──
    'POST /api/v1/media',
    'POST /api/v1/media/block-upload',
    'POST /api/v1/media/bulk',
    'GET /api/v1/media',
    'GET /api/v1/media/:id',
    'PUT /api/v1/media/:id',
    'DELETE /api/v1/media/:id',

    // ── users ──
    'GET /api/v1/users',
    'GET /api/v1/users/:id',
    'POST /api/v1/users',
    'PUT /api/v1/users/:id',
    'DELETE /api/v1/users/:id',
    'POST /api/v1/users/:id/password',
    'POST /api/v1/users/:id/avatar',
    'POST /api/v1/users/:id/ban',
    'POST /api/v1/users/:id/unban',
    'POST /api/v1/users/ban-ip',
    'GET /api/v1/users/banned/list',
    'DELETE /api/v1/users/banned/:banId',

    // ── messages ──
    'POST /api/v1/messages',
    'GET /api/v1/messages',
    'GET /api/v1/messages/:id',
    'PUT /api/v1/messages/:id/status',
    'DELETE /api/v1/messages/:id',
    'POST /api/v1/messages/bulk',
    'POST /api/v1/messages/bulk-status',
    'POST /api/v1/messages/bulk-delete',

    // ── social ──
    'GET /api/v1/social/posts',
    'GET /api/v1/social/posts/:platform',
    'GET /api/v1/social/feed',
    'GET /api/v1/social/feed/:platform',
    'GET /api/v1/social/homepage',
    'PUT /api/v1/social/homepage',
    'POST /api/v1/social/sync',
    'DELETE /api/v1/social/posts/:id',

    // ── search ──
    'GET /api/v1/search',
    'GET /api/v1/search/admin',

    // ── audit ──
    'GET /api/v1/audit',

    // ── dashboard ──
    'GET /api/v1/dashboard/summary',

    // ── auth ──
    'POST /api/v1/auth/login',
    'POST /api/v1/auth/refresh',
    'POST /api/v1/auth/logout',
    'POST /api/v1/auth/logout-all',
    'GET /api/v1/auth/me',
    'GET /api/v1/auth/patreon',
    'POST /api/v1/auth/patreon/sync',
    'GET /api/v1/auth/autologin',

    // ── api-keys ──
    'GET /api/v1/api-keys',
    'POST /api/v1/api-keys',
    'DELETE /api/v1/api-keys/:id',

    // ── connections ──
    'GET /api/v1/connections',
    'GET /api/v1/connections/:provider',
    'POST /api/v1/connections',
    'PUT /api/v1/connections/:provider',
    'DELETE /api/v1/connections/:provider',
    'PUT /api/v1/connections/:provider/reorder',
    'GET /api/v1/connections/:provider/oauth/authorize',

    // ── block-styles ──
    'GET /api/v1/block-styles',
    'GET /api/v1/block-styles/:id',
    'POST /api/v1/block-styles',
    'PUT /api/v1/block-styles/:id',
    'DELETE /api/v1/block-styles/:id',

    // ── fonts ──
    'GET /api/v1/fonts',
    'POST /api/v1/fonts',
    'DELETE /api/v1/fonts/:id',

    // ── dev ──
    'GET /api/v1/dev/crons',
    'GET /api/v1/dev/crons/:name',

    // ── health ──
    'GET /api/v1/health',
    'GET /api/v1/health/detailed',
    'GET /api/v1/health/ready',
    'GET /api/v1/health/live',

    // ── setup ──
    'GET /api/v1/setup/status',
    'POST /api/v1/setup/test-db',
    'POST /api/v1/setup/test-redis',
    'POST /api/v1/setup/test-smtp',
    'POST /api/v1/setup/test-s3',
    'POST /api/v1/setup/generate-jwt',
    'POST /api/v1/setup/install',

    // ── mailing-lists (admin CRUD + subscribers) ──
    'GET /api/v1/mailing-lists',
    'POST /api/v1/mailing-lists',
    'GET /api/v1/mailing-lists/:id',
    'PUT /api/v1/mailing-lists/:id',
    'DELETE /api/v1/mailing-lists/:id',
    'GET /api/v1/mailing-lists/:id/subscribers',
    'POST /api/v1/mailing-lists/:id/subscribers',
    'PUT /api/v1/mailing-lists/:id/subscribers/:subId',
    'DELETE /api/v1/mailing-lists/:id/subscribers/:subId',
    'POST /api/v1/mailing-lists/:id/subscribers/bulk-delete',
    'POST /api/v1/mailing-lists/:id/subscribers/:subId/force-confirm',

    // ── lists (public subscribe; same module handle) ──
    'POST /api/v1/lists/:slug/subscribe',

    // ── mail (send jobs) ──
    'POST /api/v1/mail/send',
    'GET /api/v1/mail/jobs',
    'GET /api/v1/mail/jobs/:id',
    'GET /api/v1/mail/jobs/:id/recipients',
    'POST /api/v1/mail/jobs/:id/retry',
    'PATCH /api/v1/mail/jobs/:id',

    // ── mail-templates ──
    'GET /api/v1/mail-templates/variables',
    'GET /api/v1/mail-templates',
    'POST /api/v1/mail-templates',
    'POST /api/v1/mail-templates/preview',
    'GET /api/v1/mail-templates/:id',
    'PUT /api/v1/mail-templates/:id',
    'DELETE /api/v1/mail-templates/:id',
    'PUT /api/v1/mail-templates/:id/blocks',

    // ── payments ──
    'POST /api/v1/payments/create-customer',
    'POST /api/v1/payments/donate',
    'POST /api/v1/payments/subscribe',
    'POST /api/v1/payments/unsubscribe',
    'GET /api/v1/payments/subscriptions',
    'GET /api/v1/payments/transactions',
    'GET /api/v1/payments/admin/subscriptions',
    'GET /api/v1/payments/admin/transactions',
    'GET /api/v1/payments/admin/user/:userId/transactions',
    'GET /api/v1/payments/admin/plans',
    'POST /api/v1/payments/admin/plans',
    'PUT /api/v1/payments/admin/plans/:id',
    'GET /api/v1/payments/plans',

    // ── settings ──
    'GET /api/v1/settings/public',
    'GET /api/v1/settings',
    'PUT /api/v1/settings',
    'GET /api/v1/settings/homepage-hero',
    'PUT /api/v1/settings/homepage-hero',
    'GET /api/v1/settings/site-header',
    'PUT /api/v1/settings/site-header',
    'GET /api/v1/settings/admin-appearance',
    'PUT /api/v1/settings/admin-appearance',
    'GET /api/v1/settings/site-footer',
    'PUT /api/v1/settings/site-footer',
    'GET /api/v1/settings/site-branding',
    'PUT /api/v1/settings/site-branding',
    'GET /api/v1/settings/appearance',
    'PUT /api/v1/settings/appearance',
    'GET /api/v1/settings/site-colors',
    'PUT /api/v1/settings/site-colors',
    'GET /api/v1/settings/site-colors/usages/:id',
    'PUT /api/v1/settings/:key',
    'DELETE /api/v1/settings/:key',

    // ── feed / sitemap (raw, root-mounted) ──
    'GET /feed.xml',
    'GET /sitemap.xml',
    'POST /admin/sitemap/regenerate',
];

/**
 * Manifest routes the client deliberately does NOT expose. Each is a
 * server-internal redirect, raw HTML page, or signature-verified webhook with
 * no consumer-facing client surface.
 */
export const INTENTIONALLY_UNEXPOSED: string[] = [
    // Stripe webhook: raw body, signature-verified server-side.
    'POST /api/v1/payments/webhook',
    // OAuth callbacks: browser redirects that set cookies, not client calls.
    'GET /api/v1/auth/patreon/callback',
    'GET /api/v1/connections/:provider/oauth/callback',
    // Unsubscribe / opt-in confirmation: raw HTML pages served to the browser.
    'GET /u/:token',
    'GET /u/:token/resubscribe',
    'GET /lists/:slug/confirm/:token',
];
