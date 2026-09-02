/**
 * Permission manager — the one place anything asks "may this user do X".
 *
 * Features register their permissions at boot (`registerPermissions`), the
 * admin edits defaults and exceptions, and call sites use `can()` /
 * `requirePermission()`. Nothing else should query the tables directly: the
 * precedence rules in `resolve.ts` are the contract, and a second
 * implementation is how a policy starts disagreeing with itself.
 */
import type {
    PermissionCheck,
    PermissionDefinition,
    PermissionGrant,
    PermissionKey,
    PermissionWithGrants,
} from '@sitesurge/types';
import { isValidPermissionKey, } from '@sitesurge/types';
import { query, } from '../../db';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { logAudit, } from '../audit';
import { logger, } from '../../utils/logger';
import { mapRows, } from '../../utils/mapRow';
import type { AuditContext, } from '../types';
import { resolveMany, resolvePermission, type PermissionSubject, } from './resolve';

export { resolvePermission, resolveMany, } from './resolve';
export type { PermissionSubject, } from './resolve';

/**
 * In-process cache of the catalog.
 *
 * Permissions change when an admin edits them or a feature is installed —
 * rare — but they are read on potentially every request, so a DB round trip per
 * check would be pure overhead. Invalidated on every write below.
 */
let catalogCache: PermissionDefinition[] | null = null;

export function invalidatePermissionCache(): void {
    catalogCache = null;
}

// ─── Catalog ───────────────────────────────────────────────────────

export async function listPermissions(): Promise<PermissionDefinition[]> {
    if (catalogCache) return catalogCache;
    const res = await query(
        `SELECT key, feature, label, description, action, default_access,
                default_roles, is_system, created_at, updated_at
           FROM permissions
          ORDER BY feature, key`,
    );
    catalogCache = mapRows<PermissionDefinition>(res.rows,);
    return catalogCache;
}

export async function getPermission(key: PermissionKey,): Promise<PermissionDefinition | undefined> {
    return (await listPermissions()).find((p,) => p.key === key);
}

/** Grants for one permission, or for a whole subject. */
export async function grantsForKeys(keys: PermissionKey[],): Promise<PermissionGrant[]> {
    if (keys.length === 0) return [];
    const res = await query(
        `SELECT id, permission_key, subject_type, subject_id, granted, created_at
           FROM permission_grants WHERE permission_key = ANY($1)`,
        [keys,],
    );
    return mapRows<PermissionGrant>(res.rows,);
}

/**
 * Grants that could apply to one subject: their own user grants plus the grants
 * on their role. Fetching both in one query keeps a check to a single round
 * trip.
 */
async function grantsForSubject(subject: PermissionSubject,): Promise<PermissionGrant[]> {
    const res = await query(
        `SELECT id, permission_key, subject_type, subject_id, granted, created_at
           FROM permission_grants
          WHERE (subject_type = 'user' AND subject_id = $1)
             OR (subject_type = 'role' AND subject_id = $2)`,
        [subject.id ?? '', subject.role ?? '',],
    );
    return mapRows<PermissionGrant>(res.rows,);
}

// ─── Checking ──────────────────────────────────────────────────────

/** May this subject do `key`? Never throws — an error resolves to `false`. */
export async function can(subject: PermissionSubject, key: PermissionKey,): Promise<boolean> {
    return (await check(subject, key,)).allowed;
}

/** Like `can`, but returns WHY — used by the admin's permission explainer. */
export async function check(
    subject: PermissionSubject,
    key: PermissionKey,
): Promise<PermissionCheck> {
    try {
        const permission = await getPermission(key,);
        const grants = permission ? await grantsForSubject(subject,) : [];
        return resolvePermission(
            permission,
            subject,
            grants.filter((g,) => g.permissionKey === key),
        );
    } catch (e) {
        // Fail CLOSED. An availability problem must not become an authorisation
        // bypass; the caller sees a denial, which is recoverable.
        logger.error('permission check failed; denying', {
            key, error: (e as Error).message,
        },);
        return { key, allowed: false, reason: 'unknown-permission', };
    }
}

/** Every permission's answer for one subject — powers the admin UI and `/me`. */
export async function permissionsFor(
    subject: PermissionSubject,
): Promise<Record<PermissionKey, boolean>> {
    const [permissions, grants,] = await Promise.all([
        listPermissions(),
        grantsForSubject(subject,),
    ],);
    return resolveMany(permissions, subject, grants,);
}

/** Route-guard flavour: throws 403 instead of returning false. */
export async function requirePermission(
    subject: PermissionSubject,
    key: PermissionKey,
): Promise<void> {
    if (!(await can(subject, key,))) {
        throw new ForbiddenError(`You do not have permission to do this (${key}).`,);
    }
}

// ─── Registration (features declare their permissions) ─────────────

export interface PermissionRegistration {
    key: PermissionKey;
    feature?: string;
    label: string;
    description?: string;
    action?: string;
    defaultAccess?: PermissionDefinition['defaultAccess'];
    defaultRoles?: string[];
}

/**
 * Register (upsert) permissions declared in code.
 *
 * Idempotent, and deliberately NOT destructive to an operator's choices: the
 * label/description/feature refresh from code, but `default_access` and
 * `default_roles` are only written when the row is new. Re-registering on every
 * boot would otherwise silently undo an admin's policy on every deploy.
 */
export async function registerPermissions(
    registrations: PermissionRegistration[],
): Promise<{ registered: number; }> {
    if (registrations.length === 0) return { registered: 0, };

    for (const r of registrations) {
        if (!isValidPermissionKey(r.key,)) {
            throw new ValidationError(`Invalid permission key: ${r.key}`,);
        }
    }

    for (const r of registrations) {
        await query(
            `INSERT INTO permissions
                 (key, feature, label, description, action, default_access, default_roles, is_system)
             VALUES ($1, $2, $3, $4, $5, $6, $7, true)
             ON CONFLICT (key) DO UPDATE SET
                 feature = EXCLUDED.feature,
                 label = EXCLUDED.label,
                 description = EXCLUDED.description,
                 action = EXCLUDED.action,
                 is_system = true,
                 updated_at = NOW()`,
            [
                r.key,
                r.feature ?? r.key.split(':',)[0],
                r.label,
                r.description ?? null,
                r.action ?? r.key.split(':',)[1] ?? null,
                r.defaultAccess ?? 'roles',
                r.defaultRoles ?? ['admin', 'sysadmin',],
            ],
        );
    }

    invalidatePermissionCache();
    return { registered: registrations.length, };
}

// ─── Admin CRUD ────────────────────────────────────────────────────

/** The catalog with its grants resolved, grouped for the admin screen. */
export async function listWithGrants(): Promise<PermissionWithGrants[]> {
    const permissions = await listPermissions();
    const grants = await grantsForKeys(permissions.map((p,) => p.key),);

    // Names for the user chips — one query rather than one per grant.
    const userIds = [...new Set(
        grants.filter((g,) => g.subjectType === 'user').map((g,) => g.subjectId),
    ),];
    const users = userIds.length
        ? mapRows<{ id: string; email: string; displayName: string | null; }>(
            (await query(
                `SELECT id, email, display_name FROM users WHERE id = ANY($1)`,
                [userIds,],
            )).rows,
        )
        : [];
    const userById = new Map(users.map((u,) => [u.id, u,]),);

    return permissions.map((p,) => ({
        ...p,
        roleGrants: grants
            .filter((g,) => g.permissionKey === p.key && g.subjectType === 'role')
            .map((g,) => ({ role: g.subjectId, granted: g.granted, })),
        userGrants: grants
            .filter((g,) => g.permissionKey === p.key && g.subjectType === 'user')
            .map((g,) => ({
                userId: g.subjectId,
                granted: g.granted,
                email: userById.get(g.subjectId,)?.email ?? null,
                displayName: userById.get(g.subjectId,)?.displayName ?? null,
            })),
    }),);
}

export interface PermissionUpsertInput {
    key: PermissionKey;
    feature?: string;
    label?: string;
    description?: string | null;
    action?: string | null;
    defaultAccess?: PermissionDefinition['defaultAccess'];
    defaultRoles?: string[];
}

/** Create a permission by hand (not code-registered, so it stays editable). */
export async function createPermission(
    input: PermissionUpsertInput,
    ctx: AuditContext,
): Promise<PermissionDefinition> {
    if (!isValidPermissionKey(input.key,)) {
        throw new ValidationError(
            'A permission key looks like `feature:action`, e.g. `posts:write`.',
        );
    }
    const existing = await getPermission(input.key,);
    if (existing) throw new ValidationError(`Permission ${input.key} already exists.`,);

    await query(
        `INSERT INTO permissions
             (key, feature, label, description, action, default_access, default_roles, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
        [
            input.key,
            input.feature ?? input.key.split(':',)[0],
            input.label ?? input.key,
            input.description ?? null,
            input.action ?? input.key.split(':',)[1] ?? null,
            input.defaultAccess ?? 'roles',
            input.defaultRoles ?? ['admin', 'sysadmin',],
        ],
    );
    invalidatePermissionCache();
    await logAudit({
        userId: ctx.userId, action: 'create', entityType: 'permission',
        entityId: input.key, newValues: { ...input, } as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return (await getPermission(input.key,))!;
}

/** Update a permission's rule. Label/feature are code-owned for system rows. */
export async function updatePermission(
    key: PermissionKey,
    patch: Omit<PermissionUpsertInput, 'key'>,
    ctx: AuditContext,
): Promise<PermissionDefinition> {
    const existing = await getPermission(key,);
    if (!existing) throw new NotFoundError('Permission',);

    await query(
        `UPDATE permissions SET
             label = COALESCE($2, label),
             description = COALESCE($3, description),
             default_access = COALESCE($4, default_access),
             default_roles = COALESCE($5, default_roles),
             updated_at = NOW()
         WHERE key = $1`,
        [
            key,
            // A code-registered permission's label belongs to the code; letting
            // the admin edit it would be silently reverted on the next boot.
            existing.isSystem ? null : (patch.label ?? null),
            patch.description ?? null,
            patch.defaultAccess ?? null,
            patch.defaultRoles ?? null,
        ],
    );
    invalidatePermissionCache();
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'permission',
        entityId: key, newValues: { ...patch, } as unknown as Record<string, unknown>,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
    return (await getPermission(key,))!;
}

export async function deletePermission(key: PermissionKey, ctx: AuditContext,): Promise<void> {
    const existing = await getPermission(key,);
    if (!existing) throw new NotFoundError('Permission',);
    if (existing.isSystem) {
        throw new ValidationError(
            'This permission is registered by a feature and would come back on the '
            + 'next restart. Change its rule instead of deleting it.',
        );
    }
    await query(`DELETE FROM permissions WHERE key = $1`, [key,],);
    invalidatePermissionCache();
    await logAudit({
        userId: ctx.userId, action: 'delete', entityType: 'permission',
        entityId: key, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

// ─── Grants ────────────────────────────────────────────────────────

/** Add or replace one grant (allow or deny) for a role or user. */
export async function setGrant(
    key: PermissionKey,
    subjectType: 'role' | 'user',
    subjectId: string,
    granted: boolean,
    ctx: AuditContext,
): Promise<void> {
    const permission = await getPermission(key,);
    if (!permission) throw new NotFoundError('Permission',);
    if (!subjectId.trim()) throw new ValidationError('A role or user is required.',);

    await query(
        `INSERT INTO permission_grants (permission_key, subject_type, subject_id, granted, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (permission_key, subject_type, subject_id)
         DO UPDATE SET granted = EXCLUDED.granted`,
        [key, subjectType, subjectId.trim(), granted, uuidOrNull(ctx.userId,),],
    );
    await logAudit({
        userId: ctx.userId, action: 'update', entityType: 'permission',
        entityId: key, newValues: { subjectType, subjectId, granted, },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

/** Remove a grant, so the subject falls back to the permission's default. */
export async function removeGrant(
    key: PermissionKey,
    subjectType: 'role' | 'user',
    subjectId: string,
    ctx: AuditContext,
): Promise<void> {
    await query(
        `DELETE FROM permission_grants
          WHERE permission_key = $1 AND subject_type = $2 AND subject_id = $3`,
        [key, subjectType, subjectId,],
    );
    await logAudit({
        userId: ctx.userId, action: 'delete', entityType: 'permission',
        entityId: key, oldValues: { subjectType, subjectId, },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },);
}

/**
 * Resolved permissions for a user id, looking their role up first.
 *
 * Passing only an id would resolve role-based defaults as "no role" and report
 * far less access than the user actually has — which would make the admin's
 * per-user modal lie.
 */
export async function permissionsForUserId(
    userId: string,
): Promise<Record<PermissionKey, boolean>> {
    const res = await query<{ role: string; }>(
        `SELECT role FROM users WHERE id = $1`, [userId,],
    );
    if (res.rows.length === 0) throw new NotFoundError('User',);
    return permissionsFor({ id: userId, role: res.rows[0].role, },);
}

/** Everything granted to (or denied) one user, for the per-user modal. */
export async function grantsForUser(userId: string,): Promise<PermissionGrant[]> {
    const res = await query(
        `SELECT id, permission_key, subject_type, subject_id, granted, created_at
           FROM permission_grants
          WHERE subject_type = 'user' AND subject_id = $1
          ORDER BY permission_key`,
        [userId,],
    );
    return mapRows<PermissionGrant>(res.rows,);
}

/** `created_by` is a UUID FK; synthetic actors (`api-key:<name>`) become NULL. */
function uuidOrNull(value: string | null | undefined,): string | null {
    if (!value) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value,)
        ? value
        : null;
}
