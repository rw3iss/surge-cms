import { Router, } from 'express';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { ValidationError, } from '../middleware/error';
import { handleRouteError, sendSuccess, } from '../utils/response';

const router = Router();

// Global search (public - only published content)
router.get('/', async (req, res,) => {
    try {
        const { q, type, page = 1, limit = 20, } = req.query;

        if (!q || typeof q !== 'string' || q.length < 2) {
            throw new ValidationError('Search query must be at least 2 characters',);
        }

        const offset = (Number(page,) - 1) * Number(limit,);
        const results: Record<string, unknown[]> = {};
        let total = 0;

        // Search posts
        if (!type || type === 'posts') {
            const postsResult = await query(
                `SELECT id, slug, title, excerpt, featured_image, published_at,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as relevance
         FROM posts
         WHERE status = 'published' AND is_private = false
         AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY relevance DESC
         LIMIT $2 OFFSET $3`,
                [q, Number(limit,), offset,],
            );

            results.posts = postsResult.rows.map((row,) => ({
                id: row.id,
                type: 'post',
                slug: row.slug,
                title: row.title,
                excerpt: row.excerpt,
                featuredImage: row.featured_image,
                publishedAt: row.published_at,
                relevance: row.relevance,
            }));

            const postsCount = await query(
                `SELECT COUNT(*) FROM posts
         WHERE status = 'published' AND is_private = false
         AND search_vector @@ plainto_tsquery('english', $1)`,
                [q,],
            );
            total += parseInt(postsCount.rows[0].count, 10,);
        }

        // Search pages
        if (!type || type === 'pages') {
            const pagesResult = await query(
                `SELECT id, slug, title, description,
                ts_rank(search_vector, plainto_tsquery('english', $1)) as relevance
         FROM pages
         WHERE status = 'published' AND is_private = false
         AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY relevance DESC
         LIMIT $2 OFFSET $3`,
                [q, Number(limit,), offset,],
            );

            results.pages = pagesResult.rows.map((row,) => ({
                id: row.id,
                type: 'page',
                slug: row.slug,
                title: row.title,
                description: row.description,
                relevance: row.relevance,
            }));

            const pagesCount = await query(
                `SELECT COUNT(*) FROM pages
         WHERE status = 'published' AND is_private = false
         AND search_vector @@ plainto_tsquery('english', $1)`,
                [q,],
            );
            total += parseInt(pagesCount.rows[0].count, 10,);
        }

        // Search campaigns
        if (!type || type === 'campaigns') {
            const campaignsResult = await query(
                `SELECT id, slug, title, short_description, featured_image,
                goal_amount_cents, current_amount_cents
         FROM campaigns
         WHERE is_published = true AND status = 'active'
         AND (title ILIKE $1 OR description ILIKE $1)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.campaigns = campaignsResult.rows.map((row,) => ({
                id: row.id,
                type: 'campaign',
                slug: row.slug,
                title: row.title,
                description: row.short_description,
                featuredImage: row.featured_image,
                goalAmountCents: row.goal_amount_cents,
                currentAmountCents: row.current_amount_cents,
            }));

            const campaignsCount = await query(
                `SELECT COUNT(*) FROM campaigns
         WHERE is_published = true AND status = 'active'
         AND (title ILIKE $1 OR description ILIKE $1)`,
                [`%${q}%`,],
            );
            total += parseInt(campaignsCount.rows[0].count, 10,);
        }

        sendSuccess(res, results, {
            page: Number(page,),
            limit: Number(limit,),
            total,
        },);
    } catch (error) {
        handleRouteError(res, error, 'search',);
    }
},);

// Admin search (includes all content)
router.get('/admin', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { q, type, page = 1, limit = 50, } = req.query;

        if (!q || typeof q !== 'string' || q.length < 2) {
            throw new ValidationError('Search query must be at least 2 characters',);
        }

        const offset = (Number(page,) - 1) * Number(limit,);
        const results: Record<string, unknown[]> = {};
        let total = 0;

        // Search posts
        if (!type || type === 'posts') {
            const postsResult = await query(
                `SELECT id, slug, title, status, is_private, created_at
         FROM posts
         WHERE title ILIKE $1 OR content ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.posts = postsResult.rows;
            const postsCount = await query(
                'SELECT COUNT(*) FROM posts WHERE title ILIKE $1 OR content ILIKE $1',
                [`%${q}%`,],
            );
            total += parseInt(postsCount.rows[0].count, 10,);
        }

        // Search pages
        if (!type || type === 'pages') {
            const pagesResult = await query(
                `SELECT id, slug, title, status, is_private, created_at
         FROM pages
         WHERE title ILIKE $1 OR description ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.pages = pagesResult.rows;
            const pagesCount = await query(
                'SELECT COUNT(*) FROM pages WHERE title ILIKE $1 OR description ILIKE $1',
                [`%${q}%`,],
            );
            total += parseInt(pagesCount.rows[0].count, 10,);
        }

        // Search users
        if (!type || type === 'users') {
            const usersResult = await query(
                `SELECT id, email, display_name, role, is_active, created_at
         FROM users
         WHERE email ILIKE $1 OR display_name ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.users = usersResult.rows;
            const usersCount = await query(
                'SELECT COUNT(*) FROM users WHERE email ILIKE $1 OR display_name ILIKE $1',
                [`%${q}%`,],
            );
            total += parseInt(usersCount.rows[0].count, 10,);
        }

        // Search campaigns
        if (!type || type === 'campaigns') {
            const campaignsResult = await query(
                `SELECT id, slug, title, status, is_published, created_at
         FROM campaigns
         WHERE title ILIKE $1 OR description ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.campaigns = campaignsResult.rows;
            const campaignsCount = await query(
                'SELECT COUNT(*) FROM campaigns WHERE title ILIKE $1 OR description ILIKE $1',
                [`%${q}%`,],
            );
            total += parseInt(campaignsCount.rows[0].count, 10,);
        }

        // Search forms
        if (!type || type === 'forms') {
            const formsResult = await query(
                `SELECT id, slug, title, status, created_at
         FROM forms
         WHERE title ILIKE $1 OR description ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.forms = formsResult.rows;
            const formsCount = await query(
                'SELECT COUNT(*) FROM forms WHERE title ILIKE $1 OR description ILIKE $1',
                [`%${q}%`,],
            );
            total += parseInt(formsCount.rows[0].count, 10,);
        }

        // Search messages
        if (!type || type === 'messages') {
            const messagesResult = await query(
                `SELECT id, name, email, subject, status, created_at
         FROM contact_messages
         WHERE name ILIKE $1 OR email ILIKE $1 OR subject ILIKE $1 OR message ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
                [`%${q}%`, Number(limit,), offset,],
            );

            results.messages = messagesResult.rows;
            const messagesCount = await query(
                `SELECT COUNT(*) FROM contact_messages
         WHERE name ILIKE $1 OR email ILIKE $1 OR subject ILIKE $1 OR message ILIKE $1`,
                [`%${q}%`,],
            );
            total += parseInt(messagesCount.rows[0].count, 10,);
        }

        sendSuccess(res, results, {
            page: Number(page,),
            limit: Number(limit,),
            total,
        },);
    } catch (error) {
        handleRouteError(res, error, 'admin search',);
    }
},);

export default router;
