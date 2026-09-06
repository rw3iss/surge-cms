/**
 * Forgot-password / reset-password.
 *
 * ## The two rules that shape this file
 *
 * **1. Requesting a reset must not reveal whether an account exists.** The
 * endpoint answers identically for a registered address, an unregistered one, a
 * banned account and an OAuth-only account. Anything else turns the form into a
 * free account-enumeration oracle — you type an address and the response tells
 * you whether that person has an account here. So the service returns void and
 * the route always answers 200.
 *
 * **2. The token is a bearer credential.** Whoever holds it can take the
 * account over until it expires, so:
 *   - only a SHA-256 hash is stored; the plaintext exists solely in the email,
 *   - it is compared in constant time,
 *   - it is single-use — consumed in the same UPDATE that sets the password,
 *   - it expires in an hour,
 *   - every existing session is destroyed on success, because the most likely
 *     reason someone resets a password is that somebody else knows it.
 *
 * Patreon/OAuth accounts have no password to reset. They are silently ignored
 * (per rule 1) rather than told to use OAuth, which would confirm the address.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, } from '../../db';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import { nanoid, } from '../../utils/nanoid';
import { mapRow, } from '../../utils/mapRow';
import { sendPurposeMail, } from '../mail/purposes';
import type { User, } from '@sitesurge/types';

/** How long a reset link stays valid. Short: it is emailed, not stored. */
const TOKEN_TTL_MINUTES = 60;
export const RESET_EXPIRY_LABEL = '1 hour';

/** Hash a reset token for storage/lookup. SHA-256 (not bcrypt) is right here:
 *  the token is 48 random chars, so it needs no work factor to resist guessing,
 *  and lookup must be a single indexed query rather than a scan. */
function hashToken(token: string,): string {
    return crypto.createHash('sha256',).update(token,).digest('hex',);
}

/** Build the reset link, anchored at the public site. */
export function resetPasswordUrl(token: string,): string {
    const base = (config.frontendUrl as string | undefined ?? '').replace(/\/+$/, '',);
    return `${base}/reset-password?token=${encodeURIComponent(token,)}`;
}

/**
 * Start a reset. ALWAYS resolves — the caller must not be able to tell whether
 * an account was found (see rule 1).
 */
export async function requestPasswordReset(email: string,): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;

    const result = await query<{
        id: string; email: string; display_name: string | null;
        auth_provider: string | null; is_active: boolean; is_banned: boolean;
        password_hash: string | null;
    }>(
        `SELECT id, email, display_name, auth_provider, is_active, is_banned, password_hash
           FROM users WHERE LOWER(email) = $1`,
        [normalized,],
    );
    const user = result.rows[0];

    // Every one of these is a silent no-op: an attacker must not be able to
    // distinguish "no account", "banned", "deactivated" or "OAuth-only".
    if (!user || !user.is_active || user.is_banned || !user.password_hash) {
        logger.info('Password reset requested for an unusable account', { email: normalized, },);
        return;
    }

    const token = nanoid(48,);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000,);
    await query(
        `UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2, updated_at = NOW()
          WHERE id = $3`,
        [hashToken(token,), expiresAt, user.id,],
    );

    const url = resetPasswordUrl(token,);
    await sendPurposeMail('user_password_reset', {
        to: user.email,
        context: {
            user: { name: user.display_name ?? '', email: user.email, },
            // snake_case and camelCase both resolve, matching the verification
            // email's convention so operators don't have to remember which.
            reset_url: url,
            resetUrl: url,
            expires_in: RESET_EXPIRY_LABEL,
            expiresIn: RESET_EXPIRY_LABEL,
        },
    },);
}

export class ResetTokenInvalidError extends Error {
    constructor() { super('This reset link is invalid or has expired.',); }
}

/**
 * Complete a reset: set the new password, consume the token, and log every
 * session out. Throws `ResetTokenInvalidError` for a bad/expired/used token —
 * here it is safe to be specific, because the caller already holds a token.
 */
export async function resetPassword(token: string, newPassword: string,): Promise<User> {
    const hash = hashToken(token,);

    // Single UPDATE guarded on the hash AND expiry: consuming the token in the
    // same statement that sets the password makes it single-use even if two
    // requests arrive at once — the second matches no row.
    const result = await query(
        `UPDATE users
            SET password_hash = $1,
                reset_token_hash = NULL,
                reset_token_expires_at = NULL,
                updated_at = NOW()
          WHERE reset_token_hash = $2
            AND reset_token_expires_at > NOW()
            AND is_active = true
            AND is_banned = false
        RETURNING id, email, display_name, avatar_url, role, auth_provider,
                  patreon_id, patreon_tier, is_active, is_banned,
                  last_login_at, created_at, updated_at`,
        [await bcrypt.hash(newPassword, 12,), hash,],
    );
    if (result.rows.length === 0) throw new ResetTokenInvalidError();

    const user = mapRow<User>(result.rows[0],);

    // Destroy existing sessions. Someone resetting a password is often locking
    // an intruder out, and leaving that intruder's session alive would defeat
    // the whole exercise.
    await query(`DELETE FROM user_sessions WHERE user_id = $1`, [user.id,],);

    // Best-effort confirmation — the reset has already succeeded, so a mail
    // failure must not turn it into an error.
    void sendPurposeMail('user_password_changed', {
        to: user.email,
        context: { user: { name: user.displayName ?? '', email: user.email, }, },
    },);

    logger.info('Password reset completed', { userId: user.id, },);
    return user;
}

/** Clear expired reset tokens. Cheap; safe to call on a schedule. */
export async function sweepExpiredResetTokens(): Promise<number> {
    const r = await query(
        `UPDATE users SET reset_token_hash = NULL, reset_token_expires_at = NULL
          WHERE reset_token_hash IS NOT NULL AND reset_token_expires_at <= NOW()`,
    );
    return r.rowCount ?? 0;
}
