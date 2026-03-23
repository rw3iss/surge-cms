import type { Post, } from '@surge/shared';
import { query, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { mapRow, } from '../utils/mapRow';
import { sanitize, } from '../utils/sanitize';
import { deleteById, paginatedQuery, PaginatedResult, PaginationOptions, } from './base.repo';
import * as blockStylesRepo from './blockStyles.repo';

export interface ContentBlock {
    id: string;
    type: string;
    sortOrder: number;
    data: Record<string, unknown>;
}

export interface PostWithBlocks extends Post {
    contentBlocks: ContentBlock[];
    blockCount?: number;
}

export interface PostFilters {
    status?: string;
    search?: string;
    sort?: string;
    tag?: string;
    category?: string;
    publishedOnly?: boolean;
    publicOnly?: boolean;
}

// ─── Content Blocks ───

export async function findContentBlocks(postId: string,): Promise<ContentBlock[]> {
    const result = await query(
        'SELECT * FROM post_content_blocks WHERE post_id = $1 ORDER BY sort_order ASC',
        [postId,],
    );

    const blocks = result.rows.map((row,) => ({
        id: row.id as string,
        type: row.type as string,
        sortOrder: row.sort_order as number,
        data: (row.data as Record<string, unknown>) || {},
        style: row.style as Record<string, unknown> | null,
    }));

    // Resolve template IDs: if style.id exists, fetch the template and merge
    const templateIds = [
        ...new Set(
            blocks
                .filter(b => b.style?.id)
                .map(b => b.style!.id as string),
        ),
    ];

    if (templateIds.length > 0) {
        const stylesMap = await blockStylesRepo.findByIds(templateIds,);
        for (const block of blocks) {
            if (block.style?.id && stylesMap.has(block.style.id as string,)) {
                block.style = { ...stylesMap.get(block.style.id as string,), };
            }
        }
    }

    return blocks;
}

export async function saveContentBlocks(
    postId: string,
    blocks: { type: string; sort_order: number; data: Record<string, unknown>; }[],
): Promise<void> {
    await query('DELETE FROM post_content_blocks WHERE post_id = $1', [postId,],);
    for (const block of blocks) {
        const data = block.data as Record<string, any>;
        // Extract style from data.__styleRef, normalize to single style JSONB
        const styleRef = data.__styleRef as { templateId?: string; custom?: Record<string, any>; } | undefined;
        const cleanData = { ...data, };
        delete cleanData.__styleRef;

        let style: any = null;
        if (styleRef?.templateId) {
            style = JSON.stringify({ id: styleRef.templateId, },);
        } else if (styleRef?.custom) {
            style = JSON.stringify(styleRef.custom,);
        }

        await query(
            `INSERT INTO post_content_blocks (post_id, type, sort_order, data, provider, media_url, file_name, file_size, mime_type, style)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                postId,
                block.type,
                block.sort_order,
                cleanData,
                data.provider || null,
                data.url || null,
                data.fileName || null,
                data.fileSize || null,
                data.mimeType || null,
                style,
            ],
        );
    }
}

export async function reorderContentBlocks(postId: string, blockIds: string[],): Promise<void> {
    for (let i = 0; i < blockIds.length; i++) {
        await query(
            `UPDATE post_content_blocks SET sort_order = $1 WHERE id = $2 AND post_id = $3`,
            [i, blockIds[i], postId,],
        );
    }
}

// ─── Posts ───

const POST_SELECT = `SELECT p.*, u.display_name as author FROM posts p LEFT JOIN users u ON p.author_id = u.id`;

export async function findPublicPosts(
    filters: PostFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<Post>> {
    let whereClause = `WHERE p.status = 'published' AND p.is_private = false`;
    const params: unknown[] = [];

    if (filters.tag) {
        params.push(filters.tag,);
        whereClause += ` AND $${params.length} = ANY(p.tags)`;
    }
    if (filters.category) {
        params.push(filters.category,);
        whereClause += ` AND $${params.length} = ANY(p.categories)`;
    }
    if (filters.search) {
        params.push(filters.search,);
        whereClause += ` AND p.search_vector @@ plainto_tsquery('english', $${params.length})`;
    }

    return paginatedQuery<Post>(
        `${POST_SELECT} ${whereClause} ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC`,
        `SELECT COUNT(*) FROM posts p ${whereClause}`,
        params,
        pagination,
    );
}

export async function findAllPosts(
    filters: PostFilters,
    pagination: PaginationOptions,
): Promise<PaginatedResult<PostWithBlocks>> {
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.status === 'deleted') {
        params.push('deleted',);
        whereClause += ` AND p.status = $${params.length}`;
    } else if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND p.status = $${params.length}`;
    } else {
        whereClause += ` AND p.status != 'deleted'`;
    }
    if (filters.search) {
        params.push(`%${filters.search}%`,);
        whereClause += ` AND (p.title ILIKE $${params.length} OR p.slug ILIKE $${params.length})`;
    }

    let orderClause: string;
    switch (filters.sort) {
        case 'title_asc':
            orderClause = 'ORDER BY p.title ASC';
            break;
        case 'title_desc':
            orderClause = 'ORDER BY p.title DESC';
            break;
        case 'date_asc':
            orderClause = 'ORDER BY p.created_at ASC';
            break;
        case 'date_desc':
            orderClause = 'ORDER BY p.created_at DESC';
            break;
        default:
            orderClause = 'ORDER BY p.created_at DESC';
            break;
    }

    const offset = (pagination.page - 1) * pagination.limit;
    const countResult = await query(`SELECT COUNT(*) FROM posts p ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    const fullParams = [...params, pagination.limit, offset,];
    const paramLen = fullParams.length;
    const result = await query(
        `SELECT p.*, u.display_name as author,
            (SELECT COUNT(*) FROM post_content_blocks pcb WHERE pcb.post_id = p.id)::int as block_count
     FROM posts p
     LEFT JOIN users u ON p.author_id = u.id
     ${whereClause}
     ${orderClause}
     LIMIT $${paramLen - 1} OFFSET $${paramLen}`,
        fullParams,
    );

    const data = result.rows.map((row,) => {
        const post = mapRow<PostWithBlocks>(row,);
        post.blockCount = row.block_count as number;
        return post;
    },);

    return { data, total, };
}

export async function findPostBySlug(slug: string,): Promise<PostWithBlocks | null> {
    const result = await query(
        `${POST_SELECT} WHERE p.slug = $1 AND p.status = 'published' AND p.status != 'deleted'`,
        [slug,],
    );
    if (result.rows.length === 0) return null;

    const post = mapRow<PostWithBlocks>(result.rows[0],);
    post.contentBlocks = await findContentBlocks(post.id,);
    return post;
}

export async function findPostBySlugAnyStatus(slug: string,): Promise<PostWithBlocks | null> {
    const result = await query(
        `${POST_SELECT} WHERE p.slug = $1`,
        [slug,],
    );
    if (result.rows.length === 0) return null;

    const post = mapRow<PostWithBlocks>(result.rows[0],);
    post.contentBlocks = await findContentBlocks(post.id,);
    return post;
}

export async function findPostById(id: string,): Promise<PostWithBlocks> {
    const result = await query(`${POST_SELECT} WHERE p.id = $1`, [id,],);
    if (result.rows.length === 0) throw new NotFoundError('Post',);

    const post = mapRow<PostWithBlocks>(result.rows[0],);
    post.contentBlocks = await findContentBlocks(id,);
    return post;
}

export async function createPost(data: Record<string, unknown>, authorId: string,): Promise<PostWithBlocks> {
    const publishedAt = data.status === 'published' ?
        (data.publishedAt || new Date().toISOString()) :
        null;

    // Sanitize HTML content
    const content = typeof data.content === 'string' ? sanitize(data.content,) : '';

    const result = await query(
        `INSERT INTO posts (slug, title, excerpt, content, featured_image, author_id,
                        status, is_private, access_level, tags, categories, meta_title,
                        meta_description, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
        [
            data.slug,
            data.title,
            data.excerpt,
            content,
            data.featuredImage,
            authorId,
            data.status || 'draft',
            data.isPrivate || false,
            data.accessLevel || 'public',
            data.tags || [],
            data.categories || [],
            data.metaTitle,
            data.metaDescription,
            publishedAt,
        ],
    );

    const post = mapRow<PostWithBlocks>(result.rows[0],);

    if (Array.isArray(data.contentBlocks,) && data.contentBlocks.length) {
        await saveContentBlocks(post.id, data.contentBlocks as any[],);
    }

    post.contentBlocks = await findContentBlocks(post.id,);
    return post;
}

export async function updatePost(id: string, data: Record<string, unknown>,): Promise<PostWithBlocks> {
    const existing = await query('SELECT status FROM posts WHERE id = $1', [id,],);
    if (existing.rows.length === 0) throw new NotFoundError('Post',);

    const updates: string[] = [];
    const values: unknown[] = [];

    const fields: Record<string, string> = {
        slug: 'slug',
        title: 'title',
        excerpt: 'excerpt',
        content: 'content',
        featuredImage: 'featured_image',
        status: 'status',
        isPrivate: 'is_private',
        accessLevel: 'access_level',
        tags: 'tags',
        categories: 'categories',
        metaTitle: 'meta_title',
        metaDescription: 'meta_description',
    };

    for (const [camelKey, dbKey,] of Object.entries(fields,)) {
        if (data[camelKey] !== undefined) {
            // Sanitize HTML content
            let value = data[camelKey];
            if (camelKey === 'content' && typeof value === 'string') {
                value = sanitize(value,);
            }
            values.push(value,);
            updates.push(`${dbKey} = $${values.length}`,);
        }
    }

    // Set published_at on first publish
    if (data.status === 'published' && existing.rows[0].status !== 'published') {
        values.push(new Date().toISOString(),);
        updates.push(`published_at = COALESCE(published_at, $${values.length})`,);
    }

    if (updates.length > 0) {
        values.push(id,);
        await query(
            `UPDATE posts SET ${updates.join(', ',)}, updated_at = NOW() WHERE id = $${values.length}`,
            values,
        );
    }

    if (data.contentBlocks !== undefined) {
        await saveContentBlocks(id, (data.contentBlocks as any[]) || [],);
    }

    return findPostById(id,);
}

export async function deletePost(id: string,): Promise<void> {
    return deleteById('posts', id, 'Post',);
}

export async function searchPosts(
    searchQuery: string,
    pagination: PaginationOptions,
): Promise<PaginatedResult<Post>> {
    const params = [searchQuery,];

    return paginatedQuery<Post>(
        `${POST_SELECT},
            ts_rank(p.search_vector, plainto_tsquery('english', $1)) as relevance
     WHERE p.status = 'published' AND p.is_private = false
     AND p.search_vector @@ plainto_tsquery('english', $1)
     ORDER BY relevance DESC, p.published_at DESC`,
        `SELECT COUNT(*) FROM posts p
     WHERE p.status = 'published' AND p.is_private = false
     AND p.search_vector @@ plainto_tsquery('english', $1)`,
        params,
        pagination,
    );
}
