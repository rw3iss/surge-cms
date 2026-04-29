/**
 * cms.pages — CMS pages (the catch-all `/{slug}` content type).
 *
 * Wraps `repositories/pages.repo` with the SDK contract: typed CRUD
 * + slug / homepage lookups + nested block accessors. Owns cache
 * invalidation and audit logging on writes so a script that creates
 * a page via `cms.pages.create(...)` gets the same side effects an
 * HTTP POST would.
 *
 * Reads are pass-throughs to the repo. Public-visibility gating is
 * applied by the consumer (the route's auth check, or the SSR
 * pipeline) rather than baked in here — the SDK exposes both
 * "everything" and "published-only" lookups so callers pick.
 */
import type { Block, NavigationItem, Page, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import * as repo from '../repositories/pages.repo';
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

export async function reorderBlocks(
    pageId: string,
    blockIds: string[],
    ctx: AuditContext,
): Promise<void> {
    await repo.reorderBlocks(pageId, blockIds,);
    await cache.invalidatePageCache(pageId,);
    await logAudit({
        userId: ctx.userId,
        action: 'reorder',
        entityType: 'page-blocks',
        entityId: pageId,
        newValues: { blockIds, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
