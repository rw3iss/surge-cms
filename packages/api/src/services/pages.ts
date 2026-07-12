/**
 * Pages service — CMS pages (the catch-all `/{slug}` content type)
 * (headless spec).
 *
 * Wraps `repositories/pages.repo`: typed CRUD, slug / homepage lookups,
 * cached navigation/homepage/public-slug reads, nested block accessors,
 * revision history, and bulk actions. Owns cache invalidation + audit
 * logging on writes. The `sdk/pages.ts` shim re-exports it so
 * `cms.pages` keeps working for scripts and plugins.
 *
 * Caching note: `getNavigationCached` and `getHomepageCached` are
 * public-shaped — navigation surfaces only nav-visible pages and the
 * homepage query returns the published homepage. `getPublicBySlug`
 * caches ONLY non-private, public-access pages (same gate as posts'
 * getPublicBySlug), so no admin/member-shaped data reaches the cache.
 */
import type { Block, NavigationItem, Page, User, } from '@sitesurge/types';
import { AppError, NotFoundError, UnauthorizedError, } from '../core/errors';
import { checkContentAccess, ContentAccessLevel, } from '../middleware/content-access';
import * as repo from '../repositories/pages.repo';
import * as revisionsRepo from '../repositories/revisions.repo';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
import { logAudit, } from './audit';
import { cache, } from './cache';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { PageFilters, } from '../repositories/pages.repo';

// ─── Reads ────────────────────────────────────────────────────────

/**
 * Paginated admin listing. Filters mirror the repo's `PageFilters`
 * (status, search, sort, etc.). Returns the standard SDK `ListResult`.
 */
export async function list(
    filters: repo.PageFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Page>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findPages(filters, { page, limit, },);
    return {
        data: result.data,
        meta: {
            page,
            limit,
            total: result.total,
            totalPages: Math.ceil(result.total / limit,),
        },
    };
}

export async function getById(id: string,): Promise<Page | null> {
    try {
        return await repo.findPageById(id,);
    } catch {
        return null;
    }
}

/** Admin id fetch including blocks (with styles). */
export async function getByIdWithBlocks(id: string,): Promise<Page | null> {
    try {
        const page = await repo.findPageById(id,);
        page.blocks = await repo.findBlocksByPageIdWithStyles(page.id,);
        return page;
    } catch {
        return null;
    }
}

export async function getBySlug(slug: string,): Promise<Page | null> {
    return repo.findPageBySlug(slug,);
}

/** Slug lookup that ignores `status` so admin-preview and editor
 *  flows can pull drafts. */
export async function getBySlugAnyStatus(slug: string,): Promise<Page | null> {
    return repo.findPageBySlugAnyStatus(slug,);
}

export async function getHomepage(includeDrafts = false,): Promise<Page | null> {
    return repo.findHomepage(includeDrafts,);
}

export async function getNavigation(): Promise<NavigationItem[]> {
    return repo.getNavigation();
}

// ─── Cached public reads ──────────────────────────────────────────

/** Main navigation, cached 600s (public-shaped). */
export async function getNavigationCached(): Promise<NavigationItem[]> {
    const cacheKey = 'navigation:main';
    const cached = await cache.get<NavigationItem[]>(cacheKey,);
    if (cached) return cached;

    const navigation = await repo.getNavigation();
    await cache.set(cacheKey, navigation, 600,);
    return navigation;
}

/** The page flagged as homepage (with blocks), cached 300s. Returns
 *  null when none is configured. */
export async function getHomepageCached(): Promise<Page | null> {
    const cacheKey = 'page:homepage';
    const cached = await cache.get<Page>(cacheKey,);
    if (cached) return cached;

    const page = await repo.findHomepage();
    if (!page) return null;
    page.blocks = await repo.findBlocksByPageIdWithStyles(page.id, true,);
    await cache.set(cacheKey, page, 300,);
    return page;
}

/**
 * Public-side slug fetch (with blocks). Enforces privacy + membership
 * gating, mirroring posts' getPublicBySlug:
 *   - missing → NotFoundError
 *   - private + anonymous → UnauthorizedError
 *   - gated + insufficient access → AppError(403, CONTENT_LOCKED) whose
 *     `details` carries { locked, accessLevel, preview{title,
 *     description, featuredImage} }.
 * Caches public, non-private pages for anonymous readers.
 */
export async function getPublicBySlug(
    slug: string,
    user: User | undefined,
    adminPreview = false,
): Promise<Page> {
    const cacheKey = `page:slug:${slug}`;

    if (!user) {
        const cached = await cache.get<Page>(cacheKey,);
        if (cached && !cached.isPrivate) return cached;
    }

    const page = adminPreview ?
        await repo.findPageBySlugAnyStatus(slug,) :
        await repo.findPageBySlug(slug,);
    if (!page) throw new NotFoundError('Page',);

    if (page.isPrivate && !user) throw new UnauthorizedError('Authentication required',);

    const accessLevel = (page.accessLevel || 'public') as ContentAccessLevel;
    if (accessLevel !== 'public') {
        const accessCheck = await checkContentAccess(accessLevel, user,);
        if (!accessCheck.allowed) {
            throw new AppError(403, 'CONTENT_LOCKED', accessCheck.reason || 'Access denied', {
                locked: true,
                accessLevel,
                preview: {
                    title: page.title,
                    description: page.description || page.metaDescription || null,
                    featuredImage: page.ogImage || null,
                },
            },);
        }
    }

    page.blocks = await repo.findBlocksByPageIdWithStyles(page.id, true,);

    if (!page.isPrivate && accessLevel === 'public') {
        await cache.set(cacheKey, page, 300,);
    }

    return page;
}

// ─── Writes ───────────────────────────────────────────────────────

/**
 * Create a page. Validation lives at the route layer (Zod schema
 * `pageSchema`); this method assumes the input is already shape-
 * checked. Audit-logs the creation, invalidates the page cache.
 */
export async function create(data: Record<string, unknown>, ctx: AuditContext,): Promise<Page> {
    const page = await repo.createPage(data, ctx.userId,);
    await cache.invalidatePageCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'page',
        entityId: page.id,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return page;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Page> {
    // Snapshot existing state BEFORE update for revision history.
    try {
        const existing = await repo.findPageById(id,);
        if (existing) {
            await revisionsRepo.createRevision(
                'page',
                id,
                existing as unknown as Record<string, unknown>,
                ctx.userId || null,
            );
            await revisionsRepo.pruneRevisions('page', id, 50,);
        }
    } catch {
        // Don't fail the save if the revision snapshot fails.
    }

    const page = await repo.updatePage(id, patch,);
    await cache.invalidatePageCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'page',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return page;
}

export async function remove(id: string, ctx: AuditContext,): Promise<Page | null> {
    const existing = await getById(id,);
    if (!existing) return null;
    await repo.deletePage(id,);
    await cache.invalidatePageCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'page',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

// ─── Revisions ────────────────────────────────────────────────────

export async function listRevisions(pageId: string,) {
    return revisionsRepo.listRevisions('page', pageId,);
}

export async function getRevision(pageId: string, version: number,) {
    return revisionsRepo.getRevision('page', pageId, version,);
}

/** Restore a revision, snapshotting current state first. */
export async function restoreRevision(
    pageId: string,
    version: number,
    ctx: AuditContext,
): Promise<Page> {
    const revision = await revisionsRepo.getRevision('page', pageId, version,);
    const snap = revision.snapshot as Record<string, unknown>;
    const current = await repo.findPageById(pageId,);
    if (current) {
        await revisionsRepo.createRevision(
            'page',
            pageId,
            current as unknown as Record<string, unknown>,
            ctx.userId || null,
            `Pre-restore snapshot (restoring v${version})`,
        );
    }
    const restored = await repo.updatePage(pageId, {
        title: snap.title,
        slug: snap.slug,
        description: snap.description,
        status: snap.status,
        accessLevel: snap.accessLevel,
        publishAt: snap.publishAt,
    },);
    await cache.invalidatePageCache(pageId,);
    return restored;
}

// ─── Blocks ───────────────────────────────────────────────────────
//
// Page blocks are the structured content model. Routes today own
// the block CRUD endpoints; exposing them through the SDK lets
// scripts and plugins manipulate page structure without HTTP.

export async function listBlocks(pageId: string, visibleOnly = false,): Promise<Block[]> {
    return repo.findBlocksByPageIdWithStyles(pageId, visibleOnly,);
}

export async function createBlock(
    pageId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Block> {
    const block = await repo.createBlock(pageId, data,);
    await cache.invalidatePageCache(pageId,);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'block',
        entityId: block.id,
        newValues: { pageId, ...data, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return block;
}

export async function updateBlock(
    pageId: string,
    blockId: string,
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<Block> {
    const block = await repo.updateBlock(pageId, blockId, data,);
    await cache.invalidatePageCache(pageId,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'block',
        entityId: blockId,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return block;
}

export async function removeBlock(
    pageId: string,
    blockId: string,
    ctx: AuditContext,
): Promise<void> {
    await repo.deleteBlock(pageId, blockId,);
    await cache.invalidatePageCache(pageId,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'block',
        entityId: blockId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

/**
 * Reorder siblings of a single parent. `parentBlockId = null` means the
 * top-level block list. Intra-parent only — re-parenting via this call
 * is rejected by the repo.
 */
export async function reorderBlocks(
    pageId: string,
    parentBlockId: string | null,
    blockIds: string[],
    ctx: AuditContext,
): Promise<void> {
    await repo.reorderBlocks(pageId, parentBlockId, blockIds,);
    await cache.invalidatePageCache(pageId,);
    await logAudit({
        userId: ctx.userId,
        action: 'reorder',
        entityType: 'page-blocks',
        entityId: pageId,
        newValues: { parentBlockId, blockIds, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

// ─── Bulk ─────────────────────────────────────────────────────────

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'pages',
        allowedStatuses: ['draft', 'published', 'scheduled', 'archived', 'deleted',],
        softDelete: true,
        onInvalidate: () => cache.invalidatePageCache(),
    },);
}
