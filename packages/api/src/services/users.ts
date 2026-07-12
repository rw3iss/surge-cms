/**
 * Users service — admin user management (headless spec).
 *
 * Wraps `repositories/users.repo`. Auth-bearing user creation
 * (email/password sign-up, OAuth callback) lives in `services/auth`
 * and is intentionally NOT exposed here — this service is for admin /
 * scripting flows that act on existing users (bans, role changes,
 * lookups, avatar + password admin overrides). The `sdk/users.ts` shim
 * re-exports it so `cms.users` keeps working for scripts and plugins.
 */
import type { PatreonMembership, User, } from '@sitesurge/types';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import { nanoid, } from '../utils/nanoid';
import path from 'path';
import sharp from 'sharp';
import { config, } from '../config';
import { query, } from '../db';
import * as repo from '../repositories/users.repo';
import { logAudit, } from './audit';
import { cache, } from './cache';
import type { AuditContext, ListResult, PaginationOpts, } from './types';

export type { UserFilters, UserWithSubscription, } from '../repositories/users.repo';

/** Avatar files are stored under DATA_DIR/avatars (served at /avatars/…). */
export const AVATAR_DIR = path.resolve(config.dataDir, 'avatars',);
export const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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

export async function getWithMembership(
    id: string,
): Promise<{ user: User; membership: PatreonMembership | null; }> {
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

/**
 * Resize an uploaded avatar to 256×256 webp, swap it onto the user,
 * remove the staged original and any prior local avatar, and audit.
 * The route stages the upload via multer (`pre`); this owns everything
 * after.
 */
export async function setAvatar(
    id: string,
    uploadPath: string,
    ctx: AuditContext,
): Promise<User> {
    const resizedName = `avatar-${nanoid(12,)}.webp`;
    const resizedPath = path.join(AVATAR_DIR, resizedName,);

    await sharp(uploadPath,)
        .resize(256, 256, { fit: 'cover', },)
        .webp({ quality: 85, },)
        .toFile(resizedPath,);

    // Remove the original upload if it's different.
    if (uploadPath !== resizedPath) {
        await fs.unlink(uploadPath,).catch(() => {},);
    }

    // Remove the old avatar file if it was a local path.
    const oldUser = await repo.findUserById(id,);
    if (oldUser.avatarUrl?.startsWith('/avatars/',)) {
        const oldPath = path.join(AVATAR_DIR, path.basename(oldUser.avatarUrl,),);
        await fs.unlink(oldPath,).catch(() => {},);
    }

    const avatarUrl = `/avatars/${resizedName}`;
    const user = await repo.updateUser(id, { avatarUrl, },);
    await cache.invalidateUserCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'user',
        entityId: id,
        newValues: { avatarUrl, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return user;
}

/**
 * Permanently delete a user. Reads the row first (for the audit snapshot),
 * orphans the user's authored content to NULL, deletes the row, then busts
 * the user cache. The admin UI presents this as irreversible.
 */
export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    const existing = await repo.findUserById(id,);
    await repo.deleteUser(id,);
    await cache.invalidateUserCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'user',
        entityId: id,
        oldValues: { email: existing.email, displayName: existing.displayName, role: existing.role, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

/** Admin password override. */
export async function setPassword(id: string, password: string, ctx: AuditContext,): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 12,);
    await query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, id,],
    );
    await cache.invalidateUserCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'user',
        entityId: id,
        newValues: { passwordChanged: true, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
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
