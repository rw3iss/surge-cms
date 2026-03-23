import type { AuthResponse, User, UserRole, } from '@surge/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { nanoid, } from 'nanoid';
import { config, } from '../config';
import { query, transaction, } from '../db';
import { logger, } from '../utils/logger';
import { mapRow, } from '../utils/mapRow';

interface PatreonTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
}

interface PatreonUser {
    data: {
        id: string;
        attributes: {
            email: string;
            full_name: string;
            image_url: string;
            is_email_verified: boolean;
        };
    };
    included?: Array<{
        type: string;
        id: string;
        attributes: Record<string, unknown>;
    }>;
}

export function generateTokens(
    userId: string,
    role: UserRole,
): { accessToken: string; refreshToken: string; expiresAt: Date; } {
    const accessToken = jwt.sign(
        { userId, role, },
        config.jwt.secret,
        { expiresIn: config.jwt.accessTokenExpires as any, },
    );

    const refreshToken = jwt.sign(
        { userId, role, type: 'refresh', },
        config.jwt.secret,
        { expiresIn: config.jwt.refreshTokenExpires as any, },
    );

    const decoded = jwt.decode(accessToken,) as { exp: number; };
    const expiresAt = new Date(decoded.exp * 1000,);

    return { accessToken, refreshToken, expiresAt, };
}

export async function createSession(
    userId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
    ipAddress?: string,
    userAgent?: string,
): Promise<void> {
    await query(
        `INSERT INTO user_sessions (user_id, token, refresh_token, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, accessToken, refreshToken, ipAddress, userAgent, expiresAt,],
    );
}

export async function invalidateSession(token: string,): Promise<void> {
    await query('DELETE FROM user_sessions WHERE token = $1 OR refresh_token = $1', [token,],);
}

export async function invalidateAllUserSessions(userId: string,): Promise<void> {
    await query('DELETE FROM user_sessions WHERE user_id = $1', [userId,],);
}

export function getPatreonAuthUrl(state: string,): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.patreon.clientId,
        redirect_uri: config.patreon.redirectUri,
        scope: 'identity identity[email] identity.memberships campaigns.members',
        state,
    },);

    return `https://www.patreon.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangePatreonCode(code: string,): Promise<PatreonTokenResponse> {
    const response = await fetch('https://www.patreon.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
        body: new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            client_id: config.patreon.clientId,
            client_secret: config.patreon.clientSecret,
            redirect_uri: config.patreon.redirectUri,
        },),
    },);

    if (!response.ok) {
        const error = await response.text();
        logger.error('Patreon token exchange failed', { error, },);
        throw new Error('Failed to exchange Patreon authorization code',);
    }

    return response.json() as Promise<PatreonTokenResponse>;
}

export async function getPatreonUser(accessToken: string,): Promise<PatreonUser> {
    const params = new URLSearchParams({
        'fields[user]': 'email,full_name,image_url,is_email_verified',
        include: 'memberships.currently_entitled_tiers',
    },);

    const response = await fetch(
        `https://www.patreon.com/api/oauth2/v2/identity?${params.toString()}`,
        {
            headers: { Authorization: `Bearer ${accessToken}`, },
        },
    );

    if (!response.ok) {
        const error = await response.text();
        logger.error('Patreon user fetch failed', { error, },);
        throw new Error('Failed to fetch Patreon user',);
    }

    return response.json() as Promise<PatreonUser>;
}

export async function authenticateWithPatreon(
    code: string,
    ipAddress?: string,
    userAgent?: string,
): Promise<AuthResponse> {
    const tokenData = await exchangePatreonCode(code,);
    const patreonUser = await getPatreonUser(tokenData.access_token,);

    const { id: patreonId, attributes, } = patreonUser.data;
    const { email, full_name: displayName, image_url: avatarUrl, } = attributes;

    // Check if user is banned
    const banCheck = await query(
        'SELECT 1 FROM users_banned WHERE (email = $1 OR ip_address = $2) AND (expires_at IS NULL OR expires_at > NOW())',
        [email, ipAddress,],
    );

    if (banCheck.rows.length > 0) {
        throw new Error('Account has been banned',);
    }

    // Determine role
    let role: UserRole = 'member';
    if (config.adminEmails.includes(email,)) {
        role = 'admin';
    }

    // Extract tier information
    const memberships = patreonUser.included?.filter((inc,) => inc.type === 'member') || [];
    const tiers = memberships.flatMap((m,) => (m.attributes.currently_entitled_tiers as string[]) || []);
    const patreonTier = tiers.length > 0 ? tiers.join(',',) : null;

    // Upsert user
    const userResult = await transaction(async (client,) => {
        const result = await client.query(
            `INSERT INTO users (email, display_name, avatar_url, role, auth_provider, patreon_id, patreon_tier, last_login_at)
       VALUES ($1, $2, $3, $4, 'patreon', $5, $6, NOW())
       ON CONFLICT (patreon_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         patreon_tier = EXCLUDED.patreon_tier,
         last_login_at = NOW(),
         updated_at = NOW()
       RETURNING id, email, display_name, avatar_url, role, auth_provider,
                 patreon_id, patreon_tier, is_active, is_banned,
                 last_login_at, created_at, updated_at`,
            [email, displayName, avatarUrl, role, patreonId, patreonTier,],
        );

        return result.rows[0] as Record<string, unknown>;
    },);

    const user = mapRow<User>(userResult,);

    // Store/update Patreon membership data
    try {
        await upsertPatreonMembership(user.id, patreonId, patreonUser,);
    } catch (err) {
        logger.warn('Failed to upsert Patreon membership on login', { error: err, },);
    }

    const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);

    await createSession(user.id, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);

    return { user, accessToken, refreshToken, expiresAt, };
}

export async function authenticateWithEmail(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
): Promise<AuthResponse> {
    // Check if user is banned
    const banCheck = await query(
        'SELECT 1 FROM users_banned WHERE (email = $1 OR ip_address = $2) AND (expires_at IS NULL OR expires_at > NOW())',
        [email, ipAddress,],
    );

    if (banCheck.rows.length > 0) {
        throw new Error('Account has been banned',);
    }

    const result = await query(
        `SELECT id, email, password_hash, display_name, avatar_url, role,
            auth_provider, patreon_id, patreon_tier, is_active, is_banned,
            last_login_at, created_at, updated_at
     FROM users WHERE email = $1 AND auth_provider = 'email'`,
        [email,],
    );

    const dbUser = result.rows[0];

    if (!dbUser || !dbUser.password_hash) {
        throw new Error('Invalid email or password',);
    }

    const validPassword = await bcrypt.compare(password, dbUser.password_hash,);
    if (!validPassword) {
        throw new Error('Invalid email or password',);
    }

    if (!dbUser.is_active || dbUser.is_banned) {
        throw new Error('Account is disabled or banned',);
    }

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [dbUser.id,],);

    const user = mapRow<User>(dbUser,);

    const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);

    await createSession(user.id, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);

    return { user, accessToken, refreshToken, expiresAt, };
}

export async function refreshTokens(
    currentRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
): Promise<AuthResponse> {
    try {
        const decoded = jwt.verify(currentRefreshToken, config.jwt.secret,) as {
            userId: string;
            role: UserRole;
            type: string;
        };

        if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type',);
        }

        const sessionResult = await query(
            'SELECT user_id FROM user_sessions WHERE refresh_token = $1',
            [currentRefreshToken,],
        );

        if (sessionResult.rows.length === 0) {
            throw new Error('Session not found',);
        }

        const userResult = await query(
            `SELECT id, email, display_name, avatar_url, role, auth_provider,
              patreon_id, patreon_tier, is_active, is_banned,
              last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
            [decoded.userId,],
        );

        const dbUser = userResult.rows[0] as Record<string, unknown> | undefined;

        if (!dbUser || !dbUser.is_active || dbUser.is_banned) {
            await invalidateSession(currentRefreshToken,);
            throw new Error('User not found or inactive',);
        }

        // Delete old session
        await invalidateSession(currentRefreshToken,);

        const user = mapRow<User>(dbUser,);

        const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);

        await createSession(user.id, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);

        return { user, accessToken, refreshToken, expiresAt, };
    } catch {
        throw new Error('Invalid or expired refresh token',);
    }
}

export async function createAdminUser(
    email: string,
    password: string,
    displayName: string,
): Promise<User> {
    const passwordHash = await bcrypt.hash(password, 12,);

    const result = await query(
        `INSERT INTO users (email, password_hash, display_name, role, auth_provider)
     VALUES ($1, $2, $3, 'admin', 'email')
     RETURNING id, email, display_name, avatar_url, role, auth_provider,
               patreon_id, patreon_tier, is_active, is_banned,
               last_login_at, created_at, updated_at`,
        [email, passwordHash, displayName,],
    );

    return mapRow<User>(result.rows[0],);
}

export function generateState(): string {
    return nanoid(32,);
}

/**
 * Upsert Patreon membership data for a user based on the Patreon API response.
 */
export async function upsertPatreonMembership(
    userId: string,
    patreonUserId: string,
    patreonUserData: {
        included?: Array<{
            type: string;
            id: string;
            attributes: Record<string, unknown>;
        }>;
    },
): Promise<void> {
    const memberships = patreonUserData.included?.filter((inc,) => inc.type === 'member') || [];

    for (const membership of memberships) {
        const attrs = membership.attributes;
        const patronStatus = (attrs.patron_status as string) || null;
        const entitledTiers = (attrs.currently_entitled_tiers as string[]) || [];
        const lifetimeSupportCents = (attrs.lifetime_support_cents as number) || 0;
        const lastChargeDate = attrs.last_charge_date ? new Date(attrs.last_charge_date as string,) : null;
        const lastChargeStatus = (attrs.last_charge_status as string) || null;
        const pledgeCadence = (attrs.pledge_cadence as number) || null;

        await query(
            `INSERT INTO patreon_memberships (user_id, patreon_user_id, patron_status,
        currently_entitled_tiers, lifetime_support_cents, last_charge_date,
        last_charge_status, pledge_cadence, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) WHERE patreon_user_id = $2
       DO UPDATE SET
         patron_status = EXCLUDED.patron_status,
         currently_entitled_tiers = EXCLUDED.currently_entitled_tiers,
         lifetime_support_cents = EXCLUDED.lifetime_support_cents,
         last_charge_date = EXCLUDED.last_charge_date,
         last_charge_status = EXCLUDED.last_charge_status,
         pledge_cadence = EXCLUDED.pledge_cadence,
         raw_data = EXCLUDED.raw_data,
         updated_at = NOW()`,
            [
                userId,
                patreonUserId,
                patronStatus,
                JSON.stringify(entitledTiers,),
                lifetimeSupportCents,
                lastChargeDate,
                lastChargeStatus,
                pledgeCadence,
                JSON.stringify(membership,),
            ],
        );
    }

    // If no memberships found in the response, try a simpler upsert based on user info
    if (memberships.length === 0) {
        // Delete stale membership records if no active membership found
        await query(
            `UPDATE patreon_memberships SET patron_status = 'former_patron', updated_at = NOW()
       WHERE user_id = $1 AND patron_status = 'active_patron'`,
            [userId,],
        );
    }
}

/**
 * Refresh a user's Patreon membership by calling the Patreon API
 * with their stored tokens.
 */
export async function syncPatreonMembership(userId: string,): Promise<Record<string, unknown> | null> {
    // Get the user's Patreon tokens from the most recent session or stored credentials
    const userResult = await query(
        `SELECT patreon_id FROM users WHERE id = $1`,
        [userId,],
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].patreon_id) {
        throw new Error('User has no linked Patreon account',);
    }

    const patreonUserId = userResult.rows[0].patreon_id;

    // Fetch membership data directly from the Patreon API using the campaign members endpoint
    // Since we may not have stored access tokens, we use the campaign API with the site's credentials
    try {
        const params = new URLSearchParams({
            'fields[member]':
                'patron_status,currently_entitled_tiers,lifetime_support_cents,last_charge_date,last_charge_status,pledge_cadence',
            'fields[user]': 'email,full_name',
        },);

        const response = await fetch(
            `https://www.patreon.com/api/oauth2/v2/campaigns/${config.patreon.campaignId}/members?${params.toString()}`,
            {
                headers: { Authorization: `Bearer ${config.patreon.creatorAccessToken}`, },
            },
        );

        if (!response.ok) {
            logger.warn('Patreon campaign members API failed, falling back to stored data',);
            // Return current stored membership
            const existing = await query(
                'SELECT * FROM patreon_memberships WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
                [userId,],
            );
            return existing.rows[0] || null;
        }

        const data = await response.json() as Record<string, any>;
        const members = data.data || [];

        // Find this user's membership
        const userMembership = members.find((m: any,) => m.relationships?.user?.data?.id === patreonUserId);

        if (userMembership) {
            const attrs = userMembership.attributes;
            await query(
                `INSERT INTO patreon_memberships (user_id, patreon_user_id, patron_status,
          currently_entitled_tiers, lifetime_support_cents, last_charge_date,
          last_charge_status, pledge_cadence, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id) WHERE patreon_user_id = $2
         DO UPDATE SET
           patron_status = EXCLUDED.patron_status,
           currently_entitled_tiers = EXCLUDED.currently_entitled_tiers,
           lifetime_support_cents = EXCLUDED.lifetime_support_cents,
           last_charge_date = EXCLUDED.last_charge_date,
           last_charge_status = EXCLUDED.last_charge_status,
           pledge_cadence = EXCLUDED.pledge_cadence,
           raw_data = EXCLUDED.raw_data,
           updated_at = NOW()`,
                [
                    userId,
                    patreonUserId,
                    attrs.patron_status || null,
                    JSON.stringify(attrs.currently_entitled_tiers || [],),
                    attrs.lifetime_support_cents || 0,
                    attrs.last_charge_date ? new Date(attrs.last_charge_date,) : null,
                    attrs.last_charge_status || null,
                    attrs.pledge_cadence || null,
                    JSON.stringify(userMembership,),
                ],
            );

            // Also update the user's patreon_tier
            const tiers = attrs.currently_entitled_tiers || [];
            const tierStr = tiers.length > 0 ? tiers.join(',',) : null;
            await query(
                'UPDATE users SET patreon_tier = $1, updated_at = NOW() WHERE id = $2',
                [tierStr, userId,],
            );
        } else {
            // User not found as active member
            await query(
                `UPDATE patreon_memberships SET patron_status = 'former_patron', updated_at = NOW()
         WHERE user_id = $1 AND patron_status = 'active_patron'`,
                [userId,],
            );
            await query(
                'UPDATE users SET patreon_tier = NULL, updated_at = NOW() WHERE id = $1',
                [userId,],
            );
        }

        const result = await query(
            'SELECT * FROM patreon_memberships WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
            [userId,],
        );
        return result.rows[0] || null;
    } catch (error) {
        logger.error('Error syncing Patreon membership', { error, },);
        throw new Error('Failed to sync Patreon membership',);
    }
}
