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
import { isStaffRole, } from '@sitesurge/types';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import { nanoid, } from '../utils/nanoid';
import path from 'path';
import sharp from 'sharp';
import { config, } from '../config';
import { query, } from '../db';
import { ForbiddenError, ValidationError, } from '../core/errors';
import * as repo from '../repositories/users.repo';
import { logAudit, } from './audit';
import { cache, } from './cache';
import { resolveStorageProvider, } from './storage';
import type { AuditContext, ListResult, PaginationOpts, } from './types';
import { assertRoleExists, } from './subscriptionTiers';
import { setHandle, } from './handles';
import { NotFoundError, } from '../core/errors';

export type { UserFilters, UserWithSubscription, } from '../repositories/users.repo';

/**
 * Scratch dir for avatar resizing, and the legacy home of avatar files
 * (served at /avatars/…). New avatars are handed to the storage provider —
 * on S3/R2 that means the CDN — but historic `/avatars/…` URLs still resolve
 * from here, so the static route and this directory must stay.
 */
export const AVATAR_DIR = path.resolve(config.dataDir, 'avatars',);
export const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Delete a previously-stored avatar, wherever it lives. Best-effort: a failure
 * to remove the old file must never block setting/clearing the new one.
 *
 * Handles both shapes:
 *   - `/avatars/<file>`  — legacy local-disk avatars (pre-CDN).
 *   - anything else      — uploaded via the storage provider, so delete by
 *                          filename (S3/R2 key `uploads/<file>`).
 * Remote URLs we did not upload (e.g. a Patreon-hosted avatar) are left alone.
 */
async function deleteStoredAvatar(avatarUrl: string | null | undefined,): Promise<void> {
    if (!avatarUrl) return;
    const filename = path.basename(avatarUrl.split('?',)[0] ?? '',);
    if (!filename) return;

    if (avatarUrl.startsWith('/avatars/',)) {
        await fs.unlink(path.join(AVATAR_DIR, filename,),).catch(() => {},);
        return;
    }
    // Only remove files we uploaded — our avatars are always `avatar-<id>.webp`.
    // This stops an OAuth provider's avatar URL turning into a stray delete.
    if (!filename.startsWith('avatar-',)) return;
    try {
        await (await resolveStorageProvider()).delete(filename,);
    } catch {
        /* best-effort — the DB update matters more than the orphaned object */
    }
}

// ─── Reads ────────────────────────────────────────────────────────

/** Staff users for the post-author dropdown (id/displayName/role only). */
/**
 * Post authors: staff + users whose main or additional role may write their
 * own posts (`posts:write_own` — contributors), so a contributor's post shows
 * them in the editor's Author select.
 */
export async function listAuthors(): Promise<Array<{ id: string; displayName: string; role: string; }>> {
    const roles = (await query<{ key: string; }>(`SELECT key FROM roles WHERE NOT (key = ANY($1))`, [['anonymous', 'admin', 'sysadmin', 'editor',],],)).rows;
    const { can, } = await import('./permissions/index.js');
    const writers: string[] = [];
    for (const r of roles) if (await can({ role: r.key, }, 'posts:write_own',)) writers.push(r.key,);
    return repo.listStaffAuthors(writers,);
}

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

// ─── Who may manage whom ──────────────────────────────────────────

/** The admin acting on users (an admin-scope API key acts as `admin`). */
export interface UserManager { id: string; role: string; }
export type UserManageAction = 'create' | 'update' | 'password' | 'ban' | 'unban' | 'delete';

/**
 * The ONE rule set for an admin acting on a user — single-user routes and
 * bulk alike. Only a sysadmin may grant sysadmin or act on a sysadmin (set
 * their password, ban, delete, change them), and nobody changes their own
 * role, bans or deletes themselves. Before, only bulk applied this, so an
 * admin could promote themselves to sysadmin with `PUT /users/:id`.
 */
export function assertCanManage(
    caller: UserManager,
    target: { id: string; role: string; } | null,
    action: UserManageAction,
    patch: { role?: string | null; } = {},
): void {
    const isSys = caller.role === 'sysadmin';
    if (patch.role === 'sysadmin' && !isSys) throw new ForbiddenError('Only a sysadmin can grant sysadmin.',);
    if (!target) return;
    if (target.role === 'sysadmin' && !isSys) throw new ForbiddenError('Only a sysadmin can manage a sysadmin.',);
    if (target.id === caller.id) {
        if (action === 'ban' || action === 'delete') throw new ValidationError(`You cannot ${action} your own account.`,);
        if (action === 'update' && patch.role && patch.role !== target.role) throw new ValidationError('You cannot change your own role.',);
    }
}

/** `assertCanManage` for a user loaded by id (missing → 404). */
export async function guardManage(caller: UserManager, targetId: string | null, action: UserManageAction, patch: { role?: string | null; } = {},): Promise<void> {
    if (!targetId) return assertCanManage(caller, null, action, patch,);
    const r = await query<{ id: string; role: string; }>(`SELECT id, role FROM users WHERE id = $1`, [targetId,],).catch(() => ({ rows: [], }),);
    if (!r.rows[0]) throw new NotFoundError('User',);
    assertCanManage(caller, r.rows[0], action, patch,);
}

// ─── Email verification (admin) ───────────────────────────────────

/** Send a new verification link (nothing when the email is already verified). */
export async function resendVerificationFor(id: string, ctx: AuditContext,): Promise<{ sent: boolean; }> {
    const { resendVerification, } = await import('./mail/verification.js');
    const sent = await resendVerification(id,);
    if (sent) await logAudit({ userId: ctx.userId, action: 'verification_resend', entityType: 'user', entityId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return { sent, };
}

/** Mark the email verified by hand (support: the member never got the link). */
export async function markEmailVerified(id: string, ctx: AuditContext,): Promise<User> {
    const r = await query(
        `UPDATE users SET email_verified = true, verified_at = COALESCE(verified_at, NOW()), verification_token = NULL, updated_at = NOW()
          WHERE id = $1 RETURNING id, email`,
        [id,],
    );
    if (!r.rows[0]) throw new NotFoundError('User',);
    await logAudit({ userId: ctx.userId, action: 'verify_email', entityType: 'user', entityId: id, newValues: { emailVerified: true, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    await cache.invalidateUserCache(id,).catch(() => {},);
    // The address is proven now: attach applications sent from it before sign-up.
    const { claimByVerifiedEmail, } = await import('./membershipApplications.js');
    await claimByVerifiedEmail(id, String(r.rows[0].email,),);
    return repo.findUserById(id,);
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
    if (input.role) await assertRoleExists(input.role,);
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
    if (typeof patch.role === 'string') await assertRoleExists(patch.role,);
    // Handle first (same rule as the member's own profile): a taken or invalid
    // handle (409/400) must not half-apply the rest of the update.
    const { handle, extraRoles, ...rest } = patch;
    if (Array.isArray(extraRoles,)) await setExtraRoles(id, extraRoles as string[],);
    if (typeof handle === 'string') {
        const current = await query<{ handle: string | null; }>(`SELECT handle FROM users WHERE id = $1`, [id,],);
        if (handle.trim().toLowerCase() !== (current.rows[0]?.handle ?? '').toLowerCase()) await setHandle(id, handle,);
    }
    const user = Object.keys(rest,).length ? await repo.updateUser(id, rest,) : await getById(id,);
    if (!user) throw new NotFoundError('User',);
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
 * Replace a user's ADDITIONAL roles. Only member-level roles (never staff or
 * anonymous: those are primary-role decisions, made with the Role field), each
 * must exist, and the primary role is not repeated.
 */
export async function setExtraRoles(id: string, roles: string[],): Promise<string[]> {
    const wanted = [...new Set(roles.map((r,) => r.trim(),).filter(Boolean,),),];
    for (const r of wanted) {
        if (isStaffRole(r,) || r === 'anonymous') throw new ValidationError(`"${r}" cannot be an additional role — set it as the user's role instead.`,);
        await assertRoleExists(r,);
    }
    const cur = await query<{ role: string; }>(`SELECT role FROM users WHERE id = $1`, [id,],);
    if (!cur.rows[0]) throw new NotFoundError('User',);
    const list = wanted.filter((r,) => r !== cur.rows[0].role,);
    await query(`UPDATE users SET extra_roles = $2, updated_at = NOW() WHERE id = $1`, [id, list,],);
    const { invalidateUserRoles, } = await import('./permissions/index.js');
    invalidateUserRoles(id,);
    return list;
}

/** Add roles to a user's additional roles (invites; keeps what is there). */
export async function addExtraRoles(id: string, roles: string[],): Promise<string[]> {
    const cur = await query<{ extra_roles: string[] | null; }>(`SELECT extra_roles FROM users WHERE id = $1`, [id,],);
    return setExtraRoles(id, [...(cur.rows[0]?.extra_roles ?? []), ...roles,],);
}

/**
 * Resize an uploaded avatar to 512×512 webp, push it to the storage provider
 * (the CDN on S3/R2), swap it onto the user, delete the staged original AND the
 * user's previous avatar, then audit. The route stages the upload via multer
 * (`pre`); this owns everything after.
 */
export async function setAvatar(
    id: string,
    uploadPath: string,
    ctx: AuditContext,
): Promise<User> {
    const resizedName = `avatar-${nanoid(12,)}.webp`;
    // Resize to a scratch file first, then hand it to the storage provider so
    // avatars land wherever media does (S3/R2 → the CDN) instead of only ever
    // on the app server's local disk.
    const resizedPath = path.join(AVATAR_DIR, resizedName,);

    await sharp(uploadPath,)
        .resize(512, 512, { fit: 'cover', },)
        .webp({ quality: 85, },)
        .toFile(resizedPath,);

    // Remove the original upload if it's different.
    if (uploadPath !== resizedPath) {
        await fs.unlink(uploadPath,).catch(() => {},);
    }

    const storage = (await resolveStorageProvider());
    const avatarUrl = await storage.upload(resizedPath, {
        filename: resizedName,
        mimeType: 'image/webp',
        originalName: resizedName,
    },);

    // With a remote provider the scratch copy is now redundant. With the local
    // provider `upload` moved/copied it into the upload dir, so the scratch file
    // is still redundant — either way, drop it (best-effort).
    if (storage.getUrl(resizedName,) !== `/avatars/${resizedName}`) {
        await fs.unlink(resizedPath,).catch(() => {},);
    }

    const oldUser = await repo.findUserById(id,);
    await deleteStoredAvatar(oldUser.avatarUrl,);

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
 * Clear the user's avatar and delete the stored file (from the CDN when the
 * storage provider is remote), so removing a photo doesn't leave an orphan.
 */
export async function clearAvatar(id: string, ctx: AuditContext,): Promise<User> {
    const oldUser = await repo.findUserById(id,);
    await deleteStoredAvatar(oldUser.avatarUrl,);

    const user = await repo.updateUser(id, { avatarUrl: null, },);
    await cache.invalidateUserCache(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'user',
        entityId: id,
        newValues: { avatarUrl: null, },
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

// ─── Bulk ─────────────────────────────────────────────────────────

export type UserBulkAction = 'delete' | 'ban' | 'unban' | 'activate' | 'deactivate' | 'role';

export interface UserBulkResult { done: number; skipped: Array<{ id: string; reason: string; }>; }

/**
 * Apply one action to many users (Users page bulk mode). Each user goes
 * through the same single-user function (audit + cache included). Never acts
 * on the caller themselves, and only a sysadmin may act on a sysadmin.
 */
export async function bulk(
    ids: string[],
    action: UserBulkAction,
    value: string | undefined,
    caller: { id: string; role: string; },
    ctx: AuditContext,
): Promise<UserBulkResult> {
    if (action === 'role') {
        if (!value) throw new ValidationError('Choose a role.',);
        assertCanManage(caller, null, 'update', { role: value, },);
    }
    const rows = await query<{ id: string; role: string; }>(`SELECT id, role FROM users WHERE id = ANY($1::uuid[])`, [ids,],);
    const found = new Map(rows.rows.map((r,) => [r.id, r.role,]),);
    const result: UserBulkResult = { done: 0, skipped: [], };
    for (const id of ids) {
        const role = found.get(id,);
        if (!role) { result.skipped.push({ id, reason: 'not found', },); continue; }
        if (id === caller.id) { result.skipped.push({ id, reason: 'that is you', },); continue; }
        if (role === 'sysadmin' && caller.role !== 'sysadmin') { result.skipped.push({ id, reason: 'sysadmin', },); continue; }
        try {
            if (action === 'delete') await remove(id, ctx,);
            else if (action === 'ban') await ban(id, { reason: value || 'Banned by an admin', }, ctx,);
            else if (action === 'unban') await unban(id, ctx,);
            else if (action === 'activate') await update(id, { isActive: true, }, ctx,);
            else if (action === 'deactivate') await update(id, { isActive: false, }, ctx,);
            else if (action === 'role') await update(id, { role: value, }, ctx,);
            result.done++;
        } catch (e) {
            result.skipped.push({ id, reason: (e as Error).message, },);
        }
    }
    return result;
}
