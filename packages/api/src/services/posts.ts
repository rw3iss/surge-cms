/**
 * Posts service — canonical blog/news post module (headless spec).
 *
 * Wraps `repositories/posts.repo` with the service contract: typed CRUD,
 * slug + ID lookups, public-listing convenience, content-block save
 * passthrough, revision history, bulk actions, and block reorder. Owns
 * post cache invalidation and audit logging. Routes call into this
 * module through the route framework; the `sdk/posts.ts` shim re-exports
 * it so `cms.posts` keeps working for scripts and plugins.
 *
 * Two list flavours:
 *   - `list` — admin-side, all statuses (filtered by `PostFilters`).
 *   - `listPublic` — public-side, applies the published / not-private
 *     gate plus optional date / id / search filters. Returns
 *     `PostWithBlocks` when `withContentBlocks: true` is requested.
 */
import type { Post, User, } from '@sitesurge/types';
import { AppError, NotFoundError, UnauthorizedError, } from '../core/errors';
import { checkContentAccess, ContentAccessLevel, } from '../middleware/content-access';
import * as repo from '../repositories/posts.repo';
import * as revisions from './revisions';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
import { logAudit, } from './audit';
import { cache, } from './cache';
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

export interface PublicListOptions {
    filters: repo.PostFilters;
    pagination: PaginationOpts;
    /** anonymous requests read and write the Redis cache */
    anonymous: boolean;
    /** admins get drafts back when requesting an id-restricted feed
     *  (the post-list block picker lets them pin drafts; the preview
     *  must resolve them). Date/search filters keep the public gate. */
    isAdmin: boolean;
}

export async function listPublicCached(opts: PublicListOptions,): Promise<ListResult<Post>> {
    const { filters, pagination, anonymous, isAdmin, } = opts;
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;

    const cacheKey = `posts:public:${page}:${limit}:${filters.tag || ''}:${filters.category || ''}:${
        filters.search || ''}:${filters.publishedBefore || ''}:${filters.publishedAfter || ''}:${
        filters.ids ? filters.ids.join('|',) : ''}:${filters.withContentBlocks ? 'b' : ''}`;

    // Never let admin-shaped results (drafts via includeNonPublishedForIds)
    // touch the public cache — even if the caller mislabels the request
    // as anonymous (e.g. an API key, which has no `user`).
    const cacheable = anonymous && !isAdmin;

    if (cacheable) {
        const cached = await cache.get<ListResult<Post>>(cacheKey,);
        if (cached) return cached;
    }

    const result = await repo.findPublicPosts(
        { ...filters, includeNonPublishedForIds: isAdmin, },
        { page, limit, },
    );

    const out: ListResult<Post> = {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };

    if (cacheable) await cache.set(cacheKey, out, 300,);
    return out;
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

/**
 * Public-side slug fetch. Enforces privacy and membership gating:
 *   - missing → NotFoundError
 *   - private + anonymous → UnauthorizedError
 *   - gated + insufficient access → AppError(403, CONTENT_LOCKED) whose
 *     `details` carries `ContentLockedDetails` from @sitesurge/types.
 * Caches public, non-private posts for anonymous readers.
 */
export async function getPublicBySlug(
    slug: string,
    user: User | undefined,
    adminPreview = false,
): Promise<repo.PostWithBlocks> {
    const cacheKey = `post:slug:${slug}`;

    if (!user) {
        const cached = await cache.get<repo.PostWithBlocks>(cacheKey,);
        if (cached) return cached;
    }

    const post = adminPreview ?
        await repo.findPostBySlugAnyStatus(slug,) :
        await repo.findPostBySlug(slug,);
    if (!post) throw new NotFoundError('Post',);

    if (post.isPrivate && !user) throw new UnauthorizedError('Authentication required',);

    const accessLevel = (post.accessLevel || 'public') as ContentAccessLevel;
    if (accessLevel !== 'public') {
        const accessCheck = await checkContentAccess(accessLevel, user,);
        if (!accessCheck.allowed) {
            throw new AppError(403, 'CONTENT_LOCKED', accessCheck.reason || 'Access denied', {
                locked: true,
                accessLevel,
                preview: {
                    title: post.title,
                    description: post.excerpt || post.metaDescription || null,
                    featuredImage: post.featuredImage || null,
                },
            },);
        }
    }

    if (!post.isPrivate && accessLevel === 'public') {
        await cache.set(cacheKey, post, 300,);
    }

    return post;
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
    // Snapshot once the writes settle rather than before this one — a save is
    // this update plus a separate write for the content blocks.
    revisions.markDirty('post', id, ctx.userId || null,);
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
 *  delete+insert; the service adds cache invalidation + audit. */
export async function saveContentBlocks(
    postId: string,
    blocks: Array<{ type: string; sort_order: number; data: Record<string, unknown>; }>,
    ctx: AuditContext,
): Promise<void> {
    await repo.saveContentBlocks(postId, blocks,);
    await cache.invalidatePostCache(postId,);
    revisions.markDirty('post', postId, ctx.userId || null,);
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

// ─── Revisions ────────────────────────────────────────────────────

export async function listRevisions(postId: string,) {
    return revisions.list('post', postId,);
}

export async function getRevision(postId: string, version: number,) {
    const rev = await revisions.get('post', postId, version,);
    if (!rev) throw new NotFoundError('Revision',);
    return rev;
}

/**
 * Restore a revision: the post row AND its content blocks.
 *
 * The current state is snapshotted first so the restore can be undone. The
 * returned `restore` block reports whether content actually came back — a
 * snapshot taken before full-tree capture holds no blocks, and the caller must
 * be able to say that rather than implying otherwise.
 */
export async function restoreRevision(
    postId: string,
    version: number,
    ctx: AuditContext,
): Promise<repo.PostWithBlocks & { restore: revisions.RestoreResult; }> {
    const result = await revisions.restore('post', postId, version, ctx.userId || null,);
    await cache.invalidatePostCache(postId,);
    await logAudit({
        userId: ctx.userId,
        action: 'restore',
        entityType: 'post',
        entityId: postId,
        newValues: { version, blocksRestored: result.blocksRestored, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    const post = await repo.findPostById(postId,);
    return Object.assign(post, { restore: result, },);
}

/** Force an immediate snapshot of the post's current state, so a completed
 *  save shows up in the revision list without waiting out the settle delay. */
export async function snapshotNow(postId: string, ctx: AuditContext,) {
    const version = await revisions.flush('post', postId, ctx.userId || null,);
    return { created: version !== null, version, };
}

// ─── Bulk + block order ───────────────────────────────────────────

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'posts',
        allowedStatuses: ['draft', 'published', 'scheduled', 'archived', 'deleted',],
        softDelete: true,
        onInvalidate: () => cache.invalidatePostCache(),
    },);
}

export async function reorderContentBlocks(postId: string, blockIds: string[],): Promise<void> {
    await repo.reorderContentBlocks(postId, blockIds,);
    await cache.invalidatePostCache(postId,);
    revisions.markDirty('post', postId, null,);
}
