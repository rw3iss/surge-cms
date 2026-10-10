/** The roles the code itself knows (route auth tiers compare these). */
export type BuiltinRole = 'anonymous' | 'member' | 'editor' | 'admin' | 'sysadmin';
/** A built-in role or an operator-defined one (Settings → Permissions → Roles).
 *  A custom role is always member-level for the route auth tiers. */
export type UserRole = BuiltinRole | (string & {});

export type AuthProvider = 'patreon' | 'email';

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
