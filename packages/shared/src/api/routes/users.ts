/**
 * Wire DTOs for the /users module. Validation/multipart handling lives in
 * `packages/api/src/routes/users.ts`.
 */

import type { PatreonMembership, User, UserRole, } from '../../types/user';

// ─── Entities carried on the wire ─────────────────────────────────

/**
 * A ban row as returned by GET /users/banned/list. The list query joins
 * the banner's display name, so the wire row adds `bannedByName` on top
 * of the stored ban columns. Defined here (not reusing `UserBan`) because
 * that extra column only exists on the wire. Timestamps serialize to ISO
 * strings.
 */
export interface UserBanRow {
    id: string;
    email: string | null;
    ipAddress: string | null;
    reason: string | null;
    bannedBy: string | null;
    bannedByName: string | null;
    createdAt: string;
    expiresAt: string | null;
}

/** A user paired with their resolved Patreon membership (or null). */
export interface UserWithMembership {
    user: User;
    membership: PatreonMembership | null;
}

// ─── GET /users ───────────────────────────────────────────────────

/** Query accepted by GET /users. */
export interface UserListQuery {
    search?: string;
    role?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number;
    limit?: number;
}

/** GET /users — list items. Page meta rides the ApiResponse envelope. */
export type UserListResponse = User[];

// ─── GET /users/banned/list ───────────────────────────────────────

/** Query accepted by GET /users/banned/list. */
export interface UserBanListQuery {
    page?: number;
    limit?: number;
}

/** GET /users/banned/list — active bans. Page meta on the envelope. */
export type UserBanListResponse = UserBanRow[];

// ─── DELETE /users/banned/:banId ──────────────────────────────────

/** Params for DELETE /users/banned/:banId. */
export interface UserBanDeleteParams {
    banId: string;
}

/** DELETE /users/banned/:banId — confirmation message. */
export interface UserBanDeleteResponse {
    message: string;
}

// ─── POST /users/ban-ip ───────────────────────────────────────────

/** Body for POST /users/ban-ip. `ipAddress` is required at runtime
 *  (the schema shares the optional-field ban shape; the handler 400s
 *  when it is absent). */
export interface UserBanIpBody {
    ipAddress?: string;
    reason?: string;
    /** ISO date-time */
    expiresAt?: string;
}

/** POST /users/ban-ip — confirmation message. */
export interface UserBanIpResponse {
    message: string;
}

// ─── GET /users/:id ───────────────────────────────────────────────

/** Params for the user-by-id family of routes. */
export interface UserIdParams {
    id: string;
}

/** GET /users/:id — the user with their Patreon membership. */
export type UserByIdResponse = UserWithMembership;

// ─── POST /users ──────────────────────────────────────────────────

/** Body for POST /users (create). */
export interface UserCreateBody {
    email: string;
    password: string;
    displayName: string;
    role?: Extract<UserRole, 'member' | 'admin' | 'sysadmin'>;
}

/** POST /users (201) — the created user. */
export type UserCreateResponse = User;

// ─── PUT /users/:id ───────────────────────────────────────────────

/** Body for PUT /users/:id. */
export interface UserUpdateBody {
    displayName?: string;
    role?: UserRole;
    isActive?: boolean;
    avatarUrl?: string | null;
}

/** PUT /users/:id — the updated user. */
export type UserUpdateResponse = User;

// ─── POST /users/:id/avatar ───────────────────────────────────────

/**
 * POST /users/:id/avatar is a multipart upload (field "avatar"); it has
 * no JSON body schema. The image is resized to 256×256 webp server-side.
 */
export type UserAvatarUploadResponse = User;

// ─── POST /users/:id/password ─────────────────────────────────────

/** Body for POST /users/:id/password. */
export interface UserPasswordBody {
    password: string;
}

/** POST /users/:id/password — confirmation message. */
export interface UserPasswordResponse {
    message: string;
}

// ─── POST /users/:id/ban ──────────────────────────────────────────

/** Body for POST /users/:id/ban (email/ip resolved server-side; only
 *  reason + expiry are honored here). */
export interface UserBanBody {
    reason?: string;
    /** ISO date-time */
    expiresAt?: string;
}

/** POST /users/:id/ban — confirmation message. */
export interface UserBanResponse {
    message: string;
}

// ─── POST /users/:id/unban ────────────────────────────────────────

/** POST /users/:id/unban — confirmation message. */
export interface UserUnbanResponse {
    message: string;
}

// ─── DELETE /users/:id ────────────────────────────────────────────

/** DELETE /users/:id — confirmation message. Authored content is
 *  orphaned (not deleted); the action is audit-logged. */
export interface UserDeleteResponse {
    message: string;
}
