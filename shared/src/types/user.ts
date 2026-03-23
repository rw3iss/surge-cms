export type UserRole = 'anonymous' | 'member' | 'admin';

export type AuthProvider = 'patreon' | 'email';

export interface User {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
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
