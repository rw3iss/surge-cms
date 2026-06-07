/**
 * Block styles service — reusable style templates for content blocks.
 *
 * Wraps `repositories/blockStyles.repo`, owns the list cache, and logs
 * audit on writes. Routes call into this module; the `sdk/blockStyles`
 * shim re-exports it so `cms.blockStyles` keeps working for scripts and
 * the block-style resolver.
 *
 * The `block_styles:all` list cache (600s) holds ADMIN-ONLY data behind
 * admin auth — it is never publicly served, so there is no
 * cache-poisoning vector and it caches unconditionally.
 */
import type { BlockStyle, } from '@rw/cms-shared';
import { logAudit, } from './audit';
import { cache, } from './cache';
import * as repo from '../repositories/blockStyles.repo';
import type { AuditContext, ListResult, } from './types';

const CACHE_KEY = 'block_styles:all';

type BlockStyleRow = Awaited<ReturnType<typeof repo.findById>>;

/** Convert null values to undefined so they match Partial<BlockStyle>. */
function nullsToUndefined(obj: Record<string, unknown>,): Partial<BlockStyle> {
    const result: Record<string, unknown> = {};
    for (const [key, value,] of Object.entries(obj,)) {
        result[key] = value === null ? undefined : value;
    }
    return result as Partial<BlockStyle>;
}

/** All block styles, served from cache when warm. */
export async function listAllCached(): Promise<BlockStyleRow[]> {
    const cached = await cache.get<BlockStyleRow[]>(CACHE_KEY,);
    if (cached) return cached;
    const styles = await repo.findAll();
    await cache.set(CACHE_KEY, styles, 600,);
    return styles;
}

export async function list(): Promise<ListResult<BlockStyleRow>> {
    const data = await repo.findAll();
    return { data, };
}

export async function getById(id: string,): Promise<BlockStyleRow | null> {
    try {
        return await repo.findById(id,);
    } catch {
        return null;
    }
}

export async function getByIds(ids: string[],): Promise<Map<string, BlockStyleRow>> {
    return repo.findByIds(ids,);
}

export async function getDefault(): Promise<BlockStyleRow | null> {
    return repo.findDefault();
}

export async function create(
    data: Record<string, unknown>,
    ctx: AuditContext,
): Promise<BlockStyleRow> {
    const style = await repo.create(nullsToUndefined(data,),);
    await cache.del(CACHE_KEY,);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'block_style',
        entityId: style.id,
        newValues: data,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return style;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<BlockStyleRow> {
    // Don't strip nulls on update — null means "clear this field".
    // buildUpdateSet skips undefined but passes null through to SET col = NULL.
    const style = await repo.update(id, patch as Partial<BlockStyle>,);
    await cache.del(CACHE_KEY,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'block_style',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return style;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    await repo.remove(id,);
    await cache.del(CACHE_KEY,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'block_style',
        entityId: id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
