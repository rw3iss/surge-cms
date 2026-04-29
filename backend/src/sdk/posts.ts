/**
 * cms.posts — blog/news posts.
 *
 * Wraps `repositories/posts.repo` with the SDK contract: typed CRUD,
 * slug + ID lookups, public-listing convenience, content-block save
 * passthrough. Owns post cache invalidation and audit logging.
 *
 * Two list flavours:
 *   - `list` — admin-side, all statuses (filtered by `PostFilters`).
 *   - `listPublic` — public-side, applies the published / not-private
 *     gate plus optional date / id / search filters. Returns
 *     `PostWithBlocks` when `withContentBlocks: true` is requested.
 */
import type { Post, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import * as repo from '../repositories/posts.repo';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type {
    ContentBlock,
    PostFilters,
    PostWithBlocks,
} from '../repositories/posts.repo';

// ─── Reads ────────────────────────────────────────────────────────

export async function list(
    filters: repo.PostFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<repo.PostWithBlocks>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findAllPosts(filters, { page, limit, },);
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

export async function listPublic(
    filters: repo.PostFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<Post>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;
    const result = await repo.findPublicPosts(filters, { page, limit, },);
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

export async function getById(id: string,): Promise<repo.PostWithBlocks | null> {
    try {
        return await repo.findPostById(id,);
    } catch {
        return null;
    }
}

export async function getBySlug(slug: string,): Promise<repo.PostWithBlocks | null> {
    return repo.findPostBySlug(slug,);
}

/** Slug lookup that ignores `status` so admin previews can see drafts. */
export async function getBySlugAnyStatus(slug: string,): Promise<repo.PostWithBlocks | null> {
    return repo.findPostBySlugAnyStatus(slug,);
}

export async function search(
    q: string,
    pagination: PaginationOpts = {},
): Promise<ListResult<Post>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;
    const result = await repo.searchPosts(q, { page, limit, },);
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

// ─── Writes ───────────────────────────────────────────────────────

export async function create(
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<repo.PostWithBlocks> {
    const post = await repo.createPost(data, ctx.userId,);
    await cache.invalidatePostCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'post',
        entityId: post.id,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return post;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<repo.PostWithBlocks> {
    const post = await repo.updatePost(id, patch,);
    await cache.invalidatePostCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'post',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return post;
}

export async function remove(id: string, ctx: AuditContext,): Promise<repo.PostWithBlocks | null> {
    const existing = await getById(id,);
    if (!existing) return null;
    await repo.deletePost(id,);
    await cache.invalidatePostCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'post',
        entityId: id,
        oldValues: existing as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return existing;
}

// ─── Content blocks (post body) ──────────────────────────────────

export async function listContentBlocks(postId: string,): Promise<repo.ContentBlock[]> {
    return repo.findContentBlocks(postId,);
}

/** Replace a post's content blocks atomically. The repo handles the
 *  delete+insert; the SDK adds cache invalidation + audit. */
export async function saveContentBlocks(
    postId: string,
    blocks: Array<{ type: string; sort_order: number; data: Record<string, unknown>; }>,
    ctx: AuditContext,
): Promise<void> {
    await repo.saveContentBlocks(postId, blocks,);
    await cache.invalidatePostCache(postId,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'post-blocks',
        entityId: postId,
        newValues: { count: blocks.length, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
