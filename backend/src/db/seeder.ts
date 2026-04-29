import type { Pool, } from 'pg';
import { logger, } from '../utils/logger';
import { getPool, } from './client';

/**
 * Library form of the seed routine. Idempotent (uses ON CONFLICT) so it
 * is safe to re-run during a retried installation. Demo pages, forms,
 * and campaigns are gated behind `includeSampleContent` because the
 * setup wizard typically wants only the bare-minimum default
 * `site_settings` rows on a fresh install.
 *
 * The previous CLI seed always ran demo content and required a
 * hardcoded admin user. The wizard creates the admin via
 * `adminUserStep`; this seeder accepts the resulting admin id and uses
 * it for `created_by` foreign keys when present.
 */

export interface SeedOptions {
    /** Admin user id used for `created_by` FKs on demo content. Can be omitted; demo content is skipped if missing. */
    adminId?: string | null;
    /** When true, seed the sample pages / form / campaign. Default: false. */
    includeSampleContent?: boolean;
}

const DEFAULT_SETTINGS: Array<{ key: string; value: unknown; }> = [
    { key: 'site_name', value: 'My Site', },
    { key: 'site_description', value: 'A site powered by the RW CMS', },
    { key: 'contact_email', value: '', },
    {
        key: 'social_links',
        value: { patreon: '', youtube: '', instagram: '', facebook: '', twitter: '', tiktok: '', },
    },
    {
        key: 'theme',
        value: { primaryColor: '#e63946', secondaryColor: '#1d3557', accentColor: '#f1faee', },
    },
    // Provider flags — default OFF. The public-settings endpoint also
    // requires the feature's runtime conditions (e.g. a connected
    // provider row) before reporting the flag as `enabled`.
    { key: 'patreon_enabled', value: false, },
    // Module flags — default ON. These are core CMS modules; the
    // operator can disable any they don't use to hide the sidebar
    // nav link and reduce surface area.
    { key: 'posts_enabled', value: true, },
    { key: 'campaigns_enabled', value: true, },
    { key: 'forms_enabled', value: true, },
    { key: 'messages_enabled', value: true, },
    // 'users' is default OFF — a fresh install is admin-only by
    // default. Opening user registration is an explicit choice the
    // operator makes via Settings → General → Features → Users.
    { key: 'users_enabled', value: false, },
];

async function seedDefaultSettings(pool: Pool, adminId: string | null,): Promise<void> {
    for (const setting of DEFAULT_SETTINGS) {
        await pool.query(
            `INSERT INTO site_settings (key, value, updated_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (key) DO NOTHING`,
            [setting.key, JSON.stringify(setting.value,), adminId,],
        );
    }
}

/**
 * Always-seeded minimum: a single published homepage so the SPA's `/`
 * route doesn't 404 immediately after install. We do this even when
 * `includeSampleContent` is false because a fresh install with no
 * homepage is broken UX — the user logs in and the public site shows
 * "Page not found".
 */
async function seedHomepage(pool: Pool, adminId: string | null,): Promise<void> {
    const homeRes = await pool.query<{ id: string; }>(
        `INSERT INTO pages (slug, title, description, status, is_homepage, show_in_nav, nav_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
         RETURNING id`,
        ['home', 'Home', 'Welcome', 'published', true, true, 0, adminId,],
    );
    const homeId = homeRes.rows[0].id;
    await pool.query(
        `INSERT INTO blocks (page_id, type, title, content, settings, "order", is_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
            homeId,
            'hero',
            'Welcome',
            'Your site is live. Sign in to the admin to start customizing this page.',
            JSON.stringify({ layout: 'full', backgroundColor: '#1a1a1a', textColor: '#ffffff', },),
            0,
            true,
        ],
    );
    logger.info('Seeded homepage',);
}

async function seedSampleContent(pool: Pool, adminId: string,): Promise<void> {
    // About page
    const aboutRes = await pool.query<{ id: string; }>(
        `INSERT INTO pages (slug, title, description, status, show_in_nav, nav_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()
         RETURNING id`,
        ['about', 'About', 'About this site', 'published', true, 1, adminId,],
    );
    await pool.query(
        `INSERT INTO blocks (page_id, type, title, content, settings, "order", is_visible)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
            aboutRes.rows[0].id,
            'rich_text',
            'About',
            '<p>Tell visitors about your site.</p>',
            JSON.stringify({ layout: 'contained', },),
            0,
            true,
        ],
    );

    // Contact page (placeholder)
    await pool.query(
        `INSERT INTO pages (slug, title, description, status, show_in_nav, nav_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, updated_at = NOW()`,
        ['contact', 'Contact', 'Get in touch', 'published', true, 2, adminId,],
    );

    logger.info('Seeded sample content',);
}

export async function runSeed(
    pool: Pool = getPool(),
    options: SeedOptions = {},
): Promise<void> {
    const { adminId = null, includeSampleContent = false, } = options;
    logger.info('Running seed...', { adminId: adminId ? '<set>' : null, includeSampleContent, },);

    await seedDefaultSettings(pool, adminId,);
    // The homepage is always seeded so the public site renders something
    // on first visit. created_by is nullable on the pages table, so this
    // works even when the operator skipped admin-user creation.
    await seedHomepage(pool, adminId,);

    if (includeSampleContent && adminId) {
        await seedSampleContent(pool, adminId,);
    } else if (includeSampleContent && !adminId) {
        logger.warn('Skipping sample content seed: no admin id available for created_by FK',);
    }
}
