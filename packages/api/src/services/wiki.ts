/**
 * Wiki service — markdown pages in a tree, with search.
 *
 * Two access questions, deliberately separate:
 *   - EDITING is a permission (`wiki:write` / `wiki:delete`), site-wide.
 *   - VIEWING is per page (`view_roles`), because a wiki's whole point is that
 *     most of it is open while a few pages are not.
 */
import type {
    WikiDeleteMode,
    WikiPage,
    WikiSearchHit,
} from '@sitesurge/types';
import { generateSlug, stripMarkdown, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../core/errors';
import { query, transaction, } from '../db';
import { logAudit, } from './audit';
import { mapRow, mapRows, } from '../utils/mapRow';
import type { AuditContext, } from './types';

const COLUMNS = `id, title, slug, content, tags, categories, parent_id, view_roles,
                 status, position, created_by, created_at, updated_at`;

export interface WikiViewer {
    id?: string | null;
    role?: string | null;
}

/**
 * May this viewer see this page?
 *
 * Empty `viewRoles` means everyone — including anonymous. Staff always can, so
 * an editor is never locked out of a page they are expected to maintain.
 */
export function canView(page: Pick<WikiPage, 'viewRoles' | 'status'>, viewer: WikiViewer,): boolean {
    const role = viewer.role ?? 'anonymous';
    const isStaff = role === 'editor' || role === 'admin' || role === 'sysadmin';
    if (page.status !== 'published' && !isStaff) return false;
    if (page.viewRoles.length === 0) return true;
    if (isStaff) return true;
    return page.viewRoles.includes(role,);
}

// ─── Reads ─────────────────────────────────────────────────────────

export async function list(viewer: WikiViewer, opts: { includeUnpublished?: boolean; } = {},): Promise<WikiPage[]> {
    const res = await query(`SELECT ${COLUMNS} FROM wiki_pages ORDER BY position, title`,);
    const pages = mapRows<WikiPage>(res.rows,);
    return opts.includeUnpublished ? pages : pages.filter((p,) => canView(p, viewer,));
}

/** Look up by slug OR id — the public routes accept either. */
export async function getByIdOrSlug(idOrSlug: string, viewer: WikiViewer,): Promise<WikiPage> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug,);
    const res = await query(
        isUuid
            ? `SELECT ${COLUMNS} FROM wiki_pages WHERE id = $1`
            : `SELECT ${COLUMNS} FROM wiki_pages WHERE slug = $1`,
        [idOrSlug,],
    );
    const page = res.rows[0] ? mapRow<WikiPage>(res.rows[0],) : null;
    // A page the viewer may not see 404s rather than 403s: a 403 confirms the
    // page exists, which leaks the structure of a private wiki.
    if (!page || !canView(page, viewer,)) throw new NotFoundError('Wiki page',);
    return page;
}

export async function children(parentId: string,): Promise<WikiPage[]> {
    const res = await query(
        `SELECT ${COLUMNS} FROM wiki_pages WHERE parent_id = $1 ORDER BY position, title`,
        [parentId,],
    );
    return mapRows<WikiPage>(res.rows,);
}

// ─── Search ────────────────────────────────────────────────────────

/**
 * Search titles + content.
 *
 * Postgres `ts_rank_cd` over a weighted tsvector is the BM25-shaped part: it
 * scores term frequency and proximity, and the A/B weighting makes a title
 * match outrank a passing mention in a long page.
 *
 * A trigram similarity pass runs alongside it because a strict text-search
 * query misses partial words and typos — which is most of what people actually
 * type into a wiki search box. The two are combined, not chosen between, so a
 * misspelled title still finds the page.
 *
 * `ts_headline` returns the matched fragments with the terms wrapped in
 * `<mark>`; the caller renders that as highlighted excerpts.
 */
export async function search(
    term: string,
    viewer: WikiViewer,
    limit = 25,
): Promise<WikiSearchHit[]> {
    const q = term.trim();
    if (!q) return [];

    const res = await query(
        `WITH scored AS (
             SELECT id, title, slug, status, view_roles, updated_at, content,
                    ts_rank_cd(search_vector, websearch_to_tsquery('english', $1)) AS rank,
                    GREATEST(
                        similarity(title, $1),
                        -- Content similarity only for short-ish pages: trigram
                        -- over a very long body is noise, not signal.
                        CASE WHEN length(content) < 20000
                             THEN similarity(left(content, 20000), $1) ELSE 0 END
                    ) AS sim
               FROM wiki_pages
         )
         SELECT id, title, slug, status, view_roles, updated_at,
                (rank * 10 + sim) AS score,
                ts_headline(
                    'english',
                    -- Headline the CONTENT; the title is already shown.
                    left(content, 20000),
                    websearch_to_tsquery('english', $1),
                    'StartSel=<mark>, StopSel=</mark>, MaxFragments=3, MinWords=8, MaxWords=22, FragmentDelimiter=" … "'
                ) AS excerpt
           FROM scored
          WHERE rank > 0 OR sim > 0.15
          ORDER BY score DESC
          LIMIT $2`,
        [q, limit,],
    );

    return mapRows<WikiSearchHit & { status: string; viewRoles: string[]; }>(res.rows,)
        // Filter AFTER scoring: a page the viewer can't see must not appear,
        // and doing it in SQL would need the role rules duplicated there.
        .filter((r,) => canView(
            { viewRoles: r.viewRoles, status: r.status as WikiPage['status'], },
            viewer,
        ))
        .map(({ status: _s, viewRoles: _v, ...hit },) => hit);
}

// ─── Writes ────────────────────────────────────────────────────────

export interface WikiPageInput {
    title: string;
    slug?: string | null;
    content?: string;
    tags?: string[];
    categories?: string[];
    parentId?: string | null;
    viewRoles?: string[];
    status?: WikiPage['status'];
    position?: number;
}

/** A unique slug, suffixed only on collision. Empty input stays null. */
async function uniqueSlug(raw: string | null | undefined, exceptId?: string,): Promise<string | null> {
    const base = (raw ?? '').trim();
    if (!base) return null;
    const root = generateSlug(base,) || null;
    if (!root) return null;

    for (let n = 0; n <= 200; n += 1) {
        const candidate = n === 0 ? root : `${root}-${n}`;
        const res = await query(
            exceptId
                ? `SELECT 1 FROM wiki_pages WHERE slug = $1 AND id <> $2 LIMIT 1`
                : `SELECT 1 FROM wiki_pages WHERE slug = $1 LIMIT 1`,
            exceptId ? [candidate, exceptId,] : [candidate,],
        );
        if (res.rowCount === 0) return candidate;
    }
    return `${root}-${Date.now()}`;
}

export async function create(input: WikiPageInput, ctx: AuditContext,): Promise<WikiPage> {
    if (!input.title?.trim()) throw new ValidationError('A title is required.',);
    const slug = await uniqueSlug(input.slug,);

    const res = await query(
        `INSERT INTO wiki_pages
             (title, slug, content, tags, categories, parent_id, view_roles, status, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${COLUMNS}`,
        [
            input.title.trim(), slug, input.content ?? '',
            input.tags ?? [], input.categories ?? [],
            input.parentId ?? null, input.viewRoles ?? [],
            input.status ?? 'published', input.position ?? 0,
            uuidOrNull(ctx.userId,),
        ],
    );
    const page = mapRow<WikiPage>(res.rows[0],);
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'wiki-page',
        entityId: page.id, newValues: { title: page.title, },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return page;
}

export async function update(id: string, patch: Partial<WikiPageInput>, ctx: AuditContext,): Promise<WikiPage> {
    const existing = await query(`SELECT ${COLUMNS} FROM wiki_pages WHERE id = $1`, [id,],);
    if (existing.rowCount === 0) throw new NotFoundError('Wiki page',);
    const current = mapRow<WikiPage>(existing.rows[0],);

    if (patch.parentId) {
        await assertNoCycle(id, patch.parentId,);
    }

    const slug = patch.slug !== undefined
        ? await uniqueSlug(patch.slug, id,)
        : current.slug ?? null;

    const res = await query(
        `UPDATE wiki_pages SET
             title = COALESCE($2, title),
             slug = $3,
             content = COALESCE($4, content),
             tags = COALESCE($5, tags),
             categories = COALESCE($6, categories),
             parent_id = $7,
             view_roles = COALESCE($8, view_roles),
             status = COALESCE($9, status),
             position = COALESCE($10, position)
         WHERE id = $1
         RETURNING ${COLUMNS}`,
        [
            id,
            patch.title?.trim() ?? null,
            slug,
            patch.content ?? null,
            patch.tags ?? null,
            patch.categories ?? null,
            patch.parentId !== undefined ? patch.parentId : current.parentId ?? null,
            patch.viewRoles ?? null,
            patch.status ?? null,
            patch.position ?? null,
        ],
    );
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'wiki-page',
        entityId: id, newValues: { title: patch.title, } as Record<string, unknown>,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return mapRow<WikiPage>(res.rows[0],);
}

/**
 * Re-parenting must not create a cycle.
 *
 * A page made its own ancestor disappears from the tree entirely (it has no
 * root) and makes any recursive walk loop forever.
 */
async function assertNoCycle(id: string, newParentId: string,): Promise<void> {
    if (id === newParentId) {
        throw new ValidationError('A page cannot be its own parent.',);
    }
    const res = await query<{ id: string; }>(
        `WITH RECURSIVE ancestors AS (
             SELECT id, parent_id FROM wiki_pages WHERE id = $1
             UNION ALL
             SELECT w.id, w.parent_id FROM wiki_pages w
               JOIN ancestors a ON w.id = a.parent_id
         )
         SELECT id FROM ancestors WHERE id = $2`,
        [newParentId, id,],
    );
    if ((res.rowCount ?? 0) > 0) {
        throw new ValidationError('That would make the page a descendant of itself.',);
    }
}

/**
 * Delete a page.
 *
 * `orphan` (the default) promotes the children to roots; `cascade` removes the
 * whole subtree. The choice is explicit because silently destroying a subtree
 * is unrecoverable, and silently keeping it can leave content stranded.
 */
export async function remove(
    id: string,
    mode: WikiDeleteMode,
    ctx: AuditContext,
): Promise<{ deleted: number; orphaned: number; }> {
    return transaction(async (client,) => {
        const exists = await client.query(`SELECT id FROM wiki_pages WHERE id = $1`, [id,],);
        if (exists.rowCount === 0) throw new NotFoundError('Wiki page',);

        let deleted = 0;
        let orphaned = 0;

        if (mode === 'cascade') {
            const res = await client.query(
                `WITH RECURSIVE subtree AS (
                     SELECT id FROM wiki_pages WHERE id = $1
                     UNION ALL
                     SELECT w.id FROM wiki_pages w JOIN subtree s ON w.parent_id = s.id
                 )
                 DELETE FROM wiki_pages WHERE id IN (SELECT id FROM subtree) RETURNING id`,
                [id,],
            );
            deleted = res.rowCount ?? 0;
        } else {
            const kids = await client.query(
                `UPDATE wiki_pages SET parent_id = NULL WHERE parent_id = $1 RETURNING id`,
                [id,],
            );
            orphaned = kids.rowCount ?? 0;
            const res = await client.query(`DELETE FROM wiki_pages WHERE id = $1 RETURNING id`, [id,],);
            deleted = res.rowCount ?? 0;
        }

        await logAudit({
            userId: ctx.userId, action: 'delete', entityType: 'wiki-page',
            entityId: id, oldValues: { mode, deleted, orphaned, },
            ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },);
        return { deleted, orphaned, };
    },);
}

/** How many children a page has — the admin marks expandable rows with it. */
export async function childCounts(): Promise<Record<string, number>> {
    const res = await query<{ parent_id: string; n: string; }>(
        `SELECT parent_id, COUNT(*)::text AS n FROM wiki_pages
          WHERE parent_id IS NOT NULL GROUP BY parent_id`,
    );
    const out: Record<string, number> = {};
    for (const r of res.rows) out[r.parent_id] = Number(r.n,);
    return out;
}

/** Plain-text excerpt for listings, with the markdown stripped. */
export function excerptOf(content: string, max = 160,): string {
    const text = stripMarkdown(content,);
    return text.length > max ? `${text.slice(0, max - 1,).trimEnd()}…` : text;
}

function uuidOrNull(value: string | null | undefined,): string | null {
    if (!value) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value,)
        ? value
        : null;
}
