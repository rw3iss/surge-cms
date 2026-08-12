/**
 * Search service — global full-text/ILIKE search across content types.
 *
 * Two surfaces:
 *   - `publicSearch` — published, non-private content only (posts +
 *     pages via search_vector ranking, campaigns via ILIKE).
 *   - `adminSearch` — broader ILIKE search across posts, pages, users,
 *     campaigns, forms, and contact messages, all statuses.
 *
 * Both return `{ results, total }`; the route attaches the page/limit
 * meta. The query string is validated by the route's zod schema (min 2
 * chars).
 *
 * Open/Closed: each surface is driven by a `SearchDescriptor[]` registry
 * (`PUBLIC_SEARCHABLE` / `ADMIN_SEARCHABLE`) and ONE generic
 * `searchEntity()` that builds the ranked/ILIKE query + parallel COUNT +
 * pagination once. Adding a searchable type is one registry entry — no new
 * copy-pasted query block.
 */
import { query, } from '../db';

export interface SearchOpts {
    q: string;
    type?: string;
    page: number;
    limit: number;
}

export interface SearchResult {
    results: Record<string, unknown[]>;
    total: number;
}

/**
 * One searchable entity. `mode` decides how the single search param ($1) is
 * bound: `fts` binds the raw query (for `plainto_tsquery`/`ts_rank`), `ilike`
 * binds `%q%`. `selectSql`/`whereSql`/`orderSql` are spliced into the shared
 * main + COUNT queries; LIMIT/OFFSET are always $2/$3 on the main query.
 */
interface SearchDescriptor {
    /** Result bag key (also the `type` filter value). */
    type: string;
    /** Table (or FROM expression). */
    from: string;
    /** SELECT column list. */
    selectSql: string;
    /** WHERE conditions, referencing $1 as the (single) search param. */
    whereSql: string;
    /** ORDER BY expression. */
    orderSql: string;
    /** Search-param binding style. */
    mode: 'fts' | 'ilike';
    /** Row → response item mapper (identity for admin raw-row surfaces). */
    mapRow: (row: Record<string, any>,) => unknown;
}

/**
 * Run one descriptor: the ranked/ILIKE page query + a parallel COUNT with the
 * SAME WHERE, returning the mapped items and the total count.
 */
async function searchEntity(
    desc: SearchDescriptor,
    q: string,
    limit: number,
    offset: number,
): Promise<{ items: unknown[]; count: number; }> {
    const param = desc.mode === 'fts' ? q : `%${q}%`;

    const rowsResult = await query(
        `SELECT ${desc.selectSql}
         FROM ${desc.from}
         WHERE ${desc.whereSql}
         ORDER BY ${desc.orderSql}
         LIMIT $2 OFFSET $3`,
        [param, limit, offset,],
    );

    const items = rowsResult.rows.map(desc.mapRow,);

    const countResult = await query(
        `SELECT COUNT(*) FROM ${desc.from} WHERE ${desc.whereSql}`,
        [param,],
    );
    const count = parseInt(countResult.rows[0].count, 10,);

    return { items, count, };
}

/** Run every registry entry matching the optional `type` filter, in order. */
async function runSearch(
    registry: SearchDescriptor[],
    opts: SearchOpts,
): Promise<SearchResult> {
    const { q, type, page, limit, } = opts;
    const offset = (page - 1) * limit;
    const results: Record<string, unknown[]> = {};
    let total = 0;

    for (const desc of registry) {
        if (type && type !== desc.type) continue;
        const { items, count, } = await searchEntity(desc, q, limit, offset,);
        results[desc.type] = items;
        total += count;
    }

    return { results, total, };
}

const FTS_RANK = "ts_rank(search_vector, plainto_tsquery('english', $1)) as relevance";
const FTS_MATCH = "search_vector @@ plainto_tsquery('english', $1)";

const PUBLIC_SEARCHABLE: SearchDescriptor[] = [
    {
        type: 'posts',
        from: 'posts',
        mode: 'fts',
        selectSql: `id, slug, title, excerpt, featured_image, published_at, ${FTS_RANK}`,
        whereSql: `status = 'published' AND is_private = false AND ${FTS_MATCH}`,
        orderSql: 'relevance DESC',
        mapRow: (row,) => ({
            id: row.id,
            type: 'post',
            slug: row.slug,
            title: row.title,
            excerpt: row.excerpt,
            featuredImage: row.featured_image,
            publishedAt: row.published_at,
            relevance: row.relevance,
        }),
    },
    {
        type: 'pages',
        from: 'pages',
        mode: 'fts',
        selectSql: `id, slug, title, description, ${FTS_RANK}`,
        whereSql: `status = 'published' AND is_private = false AND ${FTS_MATCH}`,
        orderSql: 'relevance DESC',
        mapRow: (row,) => ({
            id: row.id,
            type: 'page',
            slug: row.slug,
            title: row.title,
            description: row.description,
            relevance: row.relevance,
        }),
    },
    {
        type: 'campaigns',
        from: 'campaigns',
        mode: 'ilike',
        selectSql: 'id, slug, title, short_description, featured_image, goal_amount_cents, current_amount_cents',
        whereSql: "is_published = true AND status = 'active' AND (title ILIKE $1 OR description ILIKE $1)",
        orderSql: 'created_at DESC',
        mapRow: (row,) => ({
            id: row.id,
            type: 'campaign',
            slug: row.slug,
            title: row.title,
            description: row.short_description,
            featuredImage: row.featured_image,
            goalAmountCents: row.goal_amount_cents,
            currentAmountCents: row.current_amount_cents,
        }),
    },
];

/** Admin surfaces return raw rows (identity map) across all statuses. */
const identity = (row: Record<string, any>,) => row;

const ADMIN_SEARCHABLE: SearchDescriptor[] = [
    {
        type: 'posts',
        from: 'posts',
        mode: 'ilike',
        selectSql: 'id, slug, title, status, is_private, created_at',
        whereSql: 'title ILIKE $1 OR content ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
    {
        type: 'pages',
        from: 'pages',
        mode: 'ilike',
        selectSql: 'id, slug, title, status, is_private, created_at',
        whereSql: 'title ILIKE $1 OR description ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
    {
        type: 'users',
        from: 'users',
        mode: 'ilike',
        selectSql: 'id, email, display_name, role, is_active, created_at',
        whereSql: 'email ILIKE $1 OR display_name ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
    {
        type: 'campaigns',
        from: 'campaigns',
        mode: 'ilike',
        selectSql: 'id, slug, title, status, is_published, created_at',
        whereSql: 'title ILIKE $1 OR description ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
    {
        type: 'forms',
        from: 'forms',
        mode: 'ilike',
        selectSql: 'id, slug, title, status, created_at',
        whereSql: 'title ILIKE $1 OR description ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
    {
        type: 'messages',
        from: 'contact_messages',
        mode: 'ilike',
        selectSql: 'id, name, email, subject, status, created_at',
        whereSql: 'name ILIKE $1 OR email ILIKE $1 OR subject ILIKE $1 OR message ILIKE $1',
        orderSql: 'created_at DESC',
        mapRow: identity,
    },
];

export async function publicSearch(opts: SearchOpts,): Promise<SearchResult> {
    return runSearch(PUBLIC_SEARCHABLE, opts,);
}

export async function adminSearch(opts: SearchOpts,): Promise<SearchResult> {
    return runSearch(ADMIN_SEARCHABLE, opts,);
}
