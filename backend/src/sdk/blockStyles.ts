/**
 * cms.blockStyles — reusable style templates for content blocks.
 *
 * Wraps `repositories/blockStyles.repo`. Lightweight; no separate
 * cache invalidation hook (block styles are read at editor / render
 * time and don't have their own cache namespace).
 */
import { logAudit, } from '../services/audit';
import * as repo from '../repositories/blockStyles.repo';
import type { AuditContext, ListResult, } from './types';

// Shared row shape — repo declares it inline as a type alias.
type BlockStyle = Awaited<ReturnType<typeof repo.findById>>;

export async function list(): Promise<ListResult<BlockStyle>> {
    const data = await repo.findAll();
    return { data, };
}

export async function getById(id: string,): Promise<BlockStyle | null> {
    try {
        return await repo.findById(id,);
    } catch {
        return null;
    }
}

export async function getByIds(ids: string[],): Promise<Map<string, BlockStyle>> {
    return repo.findByIds(ids,);
}

export async function getDefault(): Promise<BlockStyle | null> {
    return repo.findDefault();
}

export async function create(
    data: Partial<BlockStyle>,
    ctx: AuditContext,
): Promise<BlockStyle> {
    const style = await repo.create(data,);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'block-style',
        entityId: style.id,
        newValues: data as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return style;
}

export async function update(
    id: string,
    patch: Partial<BlockStyle>,
    ctx: AuditContext,
): Promise<BlockStyle> {
    const style = await repo.update(id, patch,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'block-style',
        entityId: id,
        newValues: patch as Record<string, unknown>,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return style;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    await repo.remove(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'block-style',
        entityId: id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
