/**
 * Email-verification tokens and send.
 *
 * The email itself is now a MAIL PURPOSE (`user_verification`), so the toggle,
 * the subject, the operator's custom blocks and the built-in default body all
 * live in the shared pipeline. What remains here is the part that is genuinely
 * specific to verification: minting the token and turning it into a URL.
 *
 * The DB write that marks an address verified lives in `services/auth.ts` —
 * it touches the users table and mints a session, which is not this file's job.
 */
import { config, } from '../../config';
import { nanoid, } from '../../utils/nanoid';
import { sendPurposeMail, } from './purposes';

/** URL-safe token stored on the user row + embedded in the verification link. */
export function generateVerificationToken(): string {
    return nanoid(48,);
}

/** Build the verification link for a token, anchored at the site frontend. */
export function verificationUrl(token: string,): string {
    const base = (config.frontendUrl as string | undefined ?? '').replace(/\/+$/, '',);
    return `${base}/verify?token=${encodeURIComponent(token,)}`;
}

/**
 * Render + send the verification email to a newly-registered member.
 *
 * Sent with `force`, unlike every other purpose. Verification gates login, so
 * an operator who has switched this template off would otherwise be creating
 * accounts that can never sign in — a far worse outcome than sending an email
 * they thought they had disabled. To stop the emails, turn off the
 * "require email verification" setting instead, which stops the gate too.
 */
export async function sendVerificationEmail(
    user: { email: string; name?: string; },
    token: string,
): Promise<void> {
    const url = verificationUrl(token,);
    await sendPurposeMail('user_verification', {
        to: user.email,
        context: {
            user: { name: user.name ?? '', email: user.email, },
            // snake_case and camelCase both resolve, so an operator doesn't
            // have to remember which convention this template uses.
            verification_url: url,
            verificationUrl: url,
        },
        force: true,
    },);
}

/**
 * A new verification link for a signed-in member who has not verified yet
 * (subscription-required mode lets them in restricted). False when already
 * verified — nothing to send.
 */
export async function resendVerification(userId: string,): Promise<boolean> {
    const { query, } = await import('../../db/index.js');
    const r = await query<{ email: string; display_name: string | null; email_verified: boolean | null; }>(
        `SELECT email, display_name, email_verified FROM users WHERE id = $1`, [userId,],
    );
    const u = r.rows[0];
    if (!u || u.email_verified !== false) return false;
    const token = generateVerificationToken();
    await query(`UPDATE users SET verification_token = $2, updated_at = NOW() WHERE id = $1`, [userId, token,],);
    await sendVerificationEmail({ email: u.email, name: u.display_name ?? undefined, }, token,);
    return true;
}
