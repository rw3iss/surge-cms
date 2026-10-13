/** The roles the code itself knows (route auth tiers compare these). */
export type BuiltinRole = 'anonymous' | 'member' | 'editor' | 'admin' | 'sysadmin';
/** A built-in role or an operator-defined one (Settings → Permissions → Roles).
 *  A custom role is always member-level for the route auth tiers. */
export type UserRole = BuiltinRole | (string & {});

export type AuthProvider = 'patreon' | 'email';

/**
 * Where a signed-in member stands under subscription-required mode
 * (Users → Settings). `restricted` = may only use the subscribe / membership /
 * account pages and pages marked "Open without a subscription".
 */
export interface MemberAccessState {
    subscriptionRequired: boolean;
    /** Active subscription at the minimum tier or above. */
    subscribed: boolean;
    emailVerified: boolean;
    restricted: boolean;
    /** First blocker: pay (or wait for approval), then verify the email. */
    reason: 'subscription' | 'pending_approval' | 'verify_email' | null;
    /** Had a paid subscription that is no longer active (renew wording). */
    lapsed: boolean;
    /** An application waiting for an admin (any mode, signed-in members). */
    pendingApplication?: import('../api/routes/membershipApplications').MembershipPendingApplication | null;
    /** Let in by a role allowed without a membership (Users → Settings), not by a membership. */
    viaRole?: boolean;
    /** Restricted because a membership payment did not go through (retry with a card). */
    failedAttempt?: import('../api/routes/membership').MembershipFailedAttempt | null;
}

export interface User {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    /** Profile fields (self-service profile page). */
    firstName?: string;
    lastName?: string;
    /** Short profile blurb, ≤250 chars. */
    bio?: string;
    locationCity?: string;
    locationState?: string;
    /** Public member page handle: `/members/:handle`. Unique, case-insensitive. */
    handle?: string | null;
    /** The member page is visible (else it 404s and their name on comments has no link). */
    profilePublic?: boolean;
    /** Reply emails (comments + forum) on/off; default on. */
    replyEmails?: boolean;
    role: UserRole;
    authProvider: AuthProvider;
    patreonId?: string;
    patreonTier?: string;
    isActive: boolean;
    isBanned: boolean;
    /** Additional roles assigned by an admin / invite (e.g. `ambassador`) — kept when
     *  the membership (which sets `role`) changes. Permissions combine both. */
    extraRoles?: string[];
    /** Latest membership application: pending / approved / rejected (null = never applied). */
    approvalStatus?: 'pending' | 'approved' | 'rejected' | null;
    lastLoginAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserBan {
    id: string;
    email?: string;
    ipAddress?: string;
    reason?: string;
    bannedBy: string;
    createdAt: Date;
    expiresAt?: Date;
}

export interface UserSession {
    id: string;
    userId: string;
    token: string;
    ipAddress: string;
    userAgent?: string;
    expiresAt: Date;
    createdAt: Date;
}

export interface PatreonMembership {
    id: string;
    patreonUserId: string;
    patronStatus: 'active_patron' | 'declined_patron' | 'former_patron';
    currentlyEntitledTiers: string[];
    lifetimeSupportCents: number;
    lastChargeDate?: Date;
    lastChargeStatus?: string;
    pledgeCadence?: number;
}

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface AuthResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}

export interface PatreonAuthResponse {
    authUrl: string;
    state: string;
}
