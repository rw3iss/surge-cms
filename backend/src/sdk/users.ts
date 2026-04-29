/**
 * cms.users — admin user management.
 *
 * Wraps `repositories/users.repo`. Auth-bearing user creation
 * (email/password sign-up, OAuth callback) lives in `services/auth`
 * and is intentionally NOT exposed here — the SDK is for admin /
 * scripting flows that act on existing users (bans, role changes,
 * lookups). Sign-up itself is a security-sensitive HTTP-only flow.
 */
import type { User, } from '@rw/shared';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import * as repo from '../repositories/users.repo';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { UserFilters, UserWithSubscription, } from '../repositories/users.repo';

// ─── Reads ────────────────────────────────────────────────────────

export async function list(
    filters: repo.UserFilters = {},
    pagination: PaginationOpts = {},
): Promise<ListResult<User>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const result = await repo.findUsers(filters, { page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function getById(id: string,): Promise<User | null> {
    try {
        return await repo.findUserById(id,);
    } catch {
        return null;
    }
}

export async function getWithMembership(id: string,): Promise<repo.UserWithSubscription | null> {
    return repo.findUserWithMembership(id,);
}

// ─── Writes ───────────────────────────────────────────────────────

/**
 * Create a user with an email/password credential. Plugins / scripts
 * use this to seed sysadmins or service accounts; the public sign-up
 * flow goes through `services/auth` instead because it carries
 * additional security checks.
 */
export async function create(
    input: { email: string; password: string; displayName: string; role?: string; },
    ctx: AuditContext,
): Promise<User> {
    const user = await repo.createUser(input,);
    await cache.invalidateUserCache();
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        newValues: { email: input.email, displayName: input.displayName, role: input.role, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return user;
}

export async function update(
    id: string,
    patch: Record<string, unknown>,
    ctx: AuditContext,
): Promise<User> {
    const user = await repo.updateUser(id, patch,);
    await cache.invalidateUserCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'user',
        entityId: id,
        newValues: patch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return user;
}

// ─── Bans ─────────────────────────────────────────────────────────

export async function ban(
    userId: string,
    opts: { reason?: string; expiresAt?: string; },
    ctx: AuditContext,
): Promise<void> {
    await repo.banUser(userId, ctx.userId, opts.reason, opts.expiresAt,);
    await cache.invalidateUserCache(userId,);
    await logAudit({
        userId: ctx.userId,
        action: 'ban',
        entityType: 'user',
        entityId: userId,
        newValues: { reason: opts.reason, expiresAt: opts.expiresAt, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export async function unban(userId: string, ctx: AuditContext,): Promise<void> {
    await repo.unbanUser(userId,);
    await cache.invalidateUserCache(userId,);
    await logAudit({
        userId: ctx.userId,
        action: 'unban',
        entityType: 'user',
        entityId: userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export async function banIp(
    ipAddress: string,
    opts: { reason?: string; expiresAt?: string; },
    ctx: AuditContext,
): Promise<void> {
    await repo.banIp(ipAddress, ctx.userId, opts.reason, opts.expiresAt,);
    await logAudit({
        userId: ctx.userId,
        action: 'ban-ip',
        entityType: 'ip',
        newValues: { ipAddress, reason: opts.reason, expiresAt: opts.expiresAt, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export async function listBans(
    pagination: PaginationOpts = {},
): Promise<ListResult<Record<string, unknown>>> {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 50;
    const result = await repo.findBans({ page, limit, },);
    return {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };
}

export async function removeBan(banId: string, ctx: AuditContext,): Promise<void> {
    await repo.removeBan(banId,);
    await logAudit({
        userId: ctx.userId,
        action: 'remove-ban',
        entityType: 'user-ban',
        entityId: banId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}
