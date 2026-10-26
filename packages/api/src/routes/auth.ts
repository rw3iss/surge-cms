import * as invites from '../services/userInvites';
import type { UserInviteAcceptBody, } from '@sitesurge/types';
/**
 * Auth routes on the manifest framework.
 *
 * Orchestration (token mint, session create/destroy, Patreon flows,
 * dev autologin) lives in `services/auth.ts`. These handlers stay thin:
 * parse → call the service → set/clear cookies on `ctx.res` → return the
 * body. Non-raw handlers may write cookies before returning because the
 * wrapper only shapes the body, not the headers. OAuth callbacks redirect
 * and are therefore `raw: true`.
 *
 * Cookie attributes (httpOnly / secure / sameSite / maxAge) are preserved
 * byte-for-byte from the pre-framework implementation — this is the auth
 * system, so behaviour preservation beats normalization.
 */
import { ensureHandle, setHandle, } from '../services/handles';
import type { Response, } from 'express';
import rateLimit, { ipKeyGenerator, } from 'express-rate-limit';
import { z, } from 'zod';
import type {
    AuthForgotPasswordBody,
    AuthLoginBody,
    AuthRefreshBody,
    AuthRegisterBody,
    AuthResetPasswordBody,
    AuthUpdateProfileBody,
    AuthVerifyEmailBody,
} from '@sitesurge/types';
import { config, } from '../config';
import { accessState, getPolicy as getSubscriptionPolicy, } from '../services/subscriptionAccess';
import { extraRolesOf, loginRouteForUser, } from '../services/loginRoute';
import { resendVerification, } from '../services/mail/verification';
import { defineRoute, } from '../api/defineRoute';
import { AppError, ForbiddenError, UnauthorizedError, } from '../core/errors';
import {
    authenticateWithEmail,
    authenticateWithPatreon,
    autologinAdmin,
    clientIp,
    createSession,
    generateState,
    generateTokens,
    getPatreonAuthUrl,
    invalidateAllUserSessions,
    invalidateSession,
    isLocalhostIp,
    refreshTokens,
    registerMember,
    resendVerificationByEmail,
    syncPatreonMembership,
    verifyEmailToken,
} from '../services/auth';
import { requestPasswordReset, resetPassword, ResetTokenInvalidError, } from '../services/auth/passwordReset';
import { isFeatureEnabledServer, } from '../services/settings';
import * as usersService from '../services/users';
import * as contactsService from '../services/contacts';
import { avatarUpload, } from './users';
import * as cache from '../services/cache';
import { logger, } from '../utils/logger';

// ─── Schemas ──────────────────────────────────────────────────────

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1,),
    /** When true, the refresh-token cookie is set with a 30-day lifetime
     * instead of the default 7. Persistence is purely a cookie-lifetime
     * concern; the server-side session row keeps its normal expiry. */
    rememberMe: z.boolean().optional(),
},) satisfies z.ZodType<AuthLoginBody>;

const registerSchema = z.object({
    name: z.string().min(1,),
    email: z.string().email(),
    password: z.string().min(8,),
    phone: z.string().max(50,).optional(),
},) satisfies z.ZodType<AuthRegisterBody>;

const verifyEmailSchema = z.object({
    token: z.string().min(1,),
},) satisfies z.ZodType<AuthVerifyEmailBody>;


const forgotPasswordSchema = z.object({
    email: z.string().email(),
},) satisfies z.ZodType<AuthForgotPasswordBody>;

const resetPasswordSchema = z.object({
    token: z.string().min(1,),
    // Matches the registration minimum; a reset must not be a way to set a
    // weaker password than signup allows.
    password: z.string().min(8,).max(200,),
},) satisfies z.ZodType<AuthResetPasswordBody>;
const updateProfileSchema = z.object({
    firstName: z.string().max(100,).nullish(),
    lastName: z.string().max(100,).nullish(),
    bio: z.string().max(250,).nullish(),
    locationCity: z.string().max(100,).nullish(),
    locationState: z.string().max(100,).nullish(),
    // Public member page: handle (validated + uniqueness in services/handles) and visibility.
    handle: z.string().max(40,).optional(),
    profilePublic: z.boolean().optional(),
    /** Email me when someone replies to my comments / forum posts. */
    replyEmails: z.boolean().optional(),
    // Contacts (CRM) fields — not user columns; mirrored onto the linked
    // contact row when the `contacts` feature is enabled.
    mobilePhone: z.string().max(255,).nullish(),
    primaryPhone: z.string().max(255,).nullish(),
    streetAddress1: z.string().max(255,).nullish(),
    streetAddress2: z.string().max(255,).nullish(),
    zip: z.string().max(255,).nullish(),
    country: z.string().max(255,).nullish(),
    timeZone: z.string().max(255,).nullish(),
    // Admin-added custom contact field. `<input type="date">` submits either a
    // bare `yyyy-mm-dd` or '' when cleared, so accept both (and null).
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd',).or(z.literal('',)).nullish(),
},) satisfies z.ZodType<AuthUpdateProfileBody>;

// `refreshToken` is optional: when omitted the handler falls back to the
// `refreshToken` cookie. Mirrors the DTO so the cookie-fallback path is
// reachable (it was unreachable when the field was required).
const refreshSchema = z.object({
    refreshToken: z.string().optional(),
},) satisfies z.ZodType<AuthRefreshBody>;

// ─── Cookie helpers ───────────────────────────────────────────────
// maxAge values mirror the pre-framework route handlers exactly.

/** Refresh-token cookie lifetimes (ms — what Express's cookie.maxAge wants). */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_COOKIE_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour (keep in sync with JWT_ACCESS_TOKEN_EXPIRES)

/**
 * Set the httpOnly access + refresh cookies. Attributes are byte-identical
 * to the per-handler blocks this replaces: httpOnly, sameSite 'lax', a
 * fixed access-cookie lifetime, and `secure` defaulting to
 * `config.isProduction`. Two knobs vary between callers:
 *   - `refreshMaxAge` — the refresh cookie's lifetime (remember-me sizes
 *     it on login/refresh; the OAuth/dev paths use the 7-day default).
 *   - `secure` — the dev autologin path forces `false`.
 */
function setAuthCookies(
    res: Response,
    tokens: { accessToken: string; refreshToken: string; },
    opts: { secure?: boolean; refreshMaxAge?: number; } = {},
): void {
    const secure = opts.secure ?? config.isProduction;
    res.cookie('accessToken', tokens.accessToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    },);
    res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        maxAge: opts.refreshMaxAge ?? REFRESH_COOKIE_MAX_AGE_MS,
    },);
}

// ─── Rate limiter (attached via `pre`) ────────────────────────────

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // attempts per window — relaxed; behind a proxy many users share an IP
    message: {
        success: false,
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Please try again in a few minutes.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    // ipKeyGenerator normalizes IPv6 addresses to a /64 subnet so v6 clients
    // can't sidestep the limit by varying low-order bits (required by
    // express-rate-limit v8); keep the 'unknown' fallback for missing IPs.
    keyGenerator: (req,) => (req.ip ? ipKeyGenerator(req.ip,) : 'unknown'),
},);

// ─── Routes ───────────────────────────────────────────────────────

/** Marks an OAuth state issued for Patreon LOGIN (social connections share the key space). */
const PATREON_LOGIN_STATE = 'patreon_login';

export const authRoutes = [

    defineRoute({
        method: 'get', path: '/patreon', auth: 'public', raw: true,
        summary: 'Start Patreon OAuth: a browser is redirected to Patreon; a JSON client gets { authUrl, state }.',
        handler: async ({ req, res, },) => {
            // The state is stored server-side (Redis, so any instance can check
            // it) and the callback refuses one it did not issue — the OAuth CSRF
            // guard. It was generated before but never verified.
            const state = generateState();
            await cache.set(cache.CACHE_KEYS.oauthState(state,), { kind: PATREON_LOGIN_STATE, }, 600,);
            const authUrl = getPatreonAuthUrl(state,);
            // The login button navigates here, so a browser must be sent on to
            // Patreon (it used to get this JSON as a page); the SDK asks for JSON.
            if (req.accepts(['html', 'json',],) === 'html') return res.redirect(authUrl,);
            res.json({ success: true, data: { authUrl, state, }, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/patreon/callback', auth: 'public', raw: true,
        summary: 'Patreon OAuth callback. Sets auth cookies, redirects to the frontend.',
        handler: async ({ req, res, },) => {
            try {
                const { code, state, error, } = req.query;

                if (error) {
                    logger.warn('Patreon OAuth error', { error, },);
                    return res.redirect(`${config.frontendUrl}/login?error=patreon_denied`,);
                }

                if (!code || typeof code !== 'string') {
                    return res.redirect(`${config.frontendUrl}/login?error=no_code`,);
                }

                const issued = typeof state === 'string'
                    ? await cache.consumeOAuthState<{ kind?: string; }>(state,)
                    : null;
                if (issued?.kind !== PATREON_LOGIN_STATE) {
                    logger.warn('Patreon callback with an unknown or expired state',);
                    return res.redirect(`${config.frontendUrl}/login?error=auth_failed`,);
                }

                const ipAddress = clientIp(req.headers, req.ip,);
                const userAgent = req.headers['user-agent'];

                const authResponse = await authenticateWithPatreon(code, ipAddress, userAgent,);

                setAuthCookies(res, authResponse,);

                const redirectUrl = req.cookies?.returnUrl || '/';
                res.clearCookie('returnUrl',);
                res.redirect(`${config.frontendUrl}${redirectUrl}?auth=success`,);
            } catch (error) {
                logger.error('Patreon callback error', { error, },);
                res.redirect(`${config.frontendUrl}/login?error=auth_failed`,);
            }
        },
    },),

    defineRoute({
        method: 'post', path: '/login', auth: 'public',
        summary: 'Email/password login. Sets auth cookies, returns the auth response.',
        pre: [loginLimiter,],
        input: { body: loginSchema, },
        handler: async ({ body, req, res, },) => {
            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];

            let authResponse;
            try {
                authResponse = await authenticateWithEmail(body.email, body.password, ipAddress, userAgent, body.rememberMe,);
            } catch (error) {
                logger.error('Login error', { error, },);
                // Typed refusals keep their code (EMAIL_NOT_VERIFIED → "Resend the link").
                if (error instanceof AppError) throw error;
                throw new UnauthorizedError(error instanceof Error ? error.message : 'Login failed',);
            }

            // Access token cookie always has the same short lifetime;
            // remember-me only affects the refresh cookie.
            setAuthCookies(res, authResponse, {
                refreshMaxAge: body.rememberMe ? REFRESH_COOKIE_REMEMBER_MS : REFRESH_COOKIE_MAX_AGE_MS,
            },);

            // Subscription-required mode: tell the SPA at once where this member stands.
            // The additional roles too (contributor, affiliate…): the SPA picks the
            // admin shell / landing page from them right after sign-in.
            if (authResponse.user && !authResponse.user.extraRoles) {
                authResponse.user.extraRoles = await extraRolesOf(authResponse.user.id,);
            }
            return { ...authResponse, access: await accessState(authResponse.user,), loginRoute: await loginRouteForUser(authResponse.user,), };
        },
    },),

    defineRoute({
        method: 'post', path: '/register', auth: 'public',
        summary: 'Public member self-registration (gated behind the `users` feature). No auto-login — except in subscription-required mode, where the new account is signed in RESTRICTED so it can pay.',
        pre: [loginLimiter,],
        input: { body: registerSchema, },
        handler: async ({ body, req, res, },) => {
            if (!(await isFeatureEnabledServer('users',))) {
                throw new ForbiddenError('Public registration is not enabled.',);
            }

            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];

            const result = await registerMember(
                { name: body.name, email: body.email, password: body.password, },
                { ipAddress, userAgent, },
            );
            // Subscription-required mode: sign the account in now (restricted
            // until it pays — and verifies, when that is on) so the Join page
            // can take the plan + payment. A failed payment leaves it restricted.
            const policy = await getSubscriptionPolicy();
            if (!policy.required) return result;
            const { accessToken, refreshToken, expiresAt, } = generateTokens(result.userId, 'member',);
            await createSession(result.userId, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);
            setAuthCookies(res, { accessToken, refreshToken, },);
            return { ...result, signedIn: true, subscriptionRequired: true, };
        },
    },),

    defineRoute({
        method: 'get', path: '/invites/:token', auth: 'public',
        summary: 'An account invite: the email, name and roles to show on the account form (404 / expired / used).',
        input: { params: z.object({ token: z.string().min(20,).max(100,), },), },
        handler: ({ params, },) => invites.publicView(params.token,),
    },),
    defineRoute({
        method: 'post', path: '/invites/:token/accept', auth: 'public',
        summary: 'Create the invited account (name, email, password), give it the invite\'s roles, and sign it in.',
        pre: [loginLimiter,],
        input: {
            params: z.object({ token: z.string().min(20,).max(100,), },),
            body: z.object({
                name: z.string().trim().min(1,).max(200,),
                email: z.string().trim().email().max(320,),
                password: z.string().min(8,).max(200,),
            },) satisfies z.ZodType<UserInviteAcceptBody>,
        },
        handler: async ({ params, body, req, res, },) => {
            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];
            const out = await invites.accept(params.token, body, { ipAddress, userAgent, },);
            const { accessToken, refreshToken, expiresAt, } = generateTokens(out.userId, out.role,);
            await createSession(out.userId, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);
            setAuthCookies(res, { accessToken, refreshToken, },);
            return { userId: out.userId, email: out.email, signedIn: true, };
        },
    },),

    defineRoute({
        method: 'post', path: '/resend-verification', auth: 'user',
        summary: 'Send a fresh email-verification link to the signed-in, unverified member.',
        pre: [loginLimiter,],
        handler: async ({ user, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            const sent = await resendVerification(user.id,);
            return { sent, };
        },
    },),

    defineRoute({
        method: 'post', path: '/resend-verification-by-email', auth: 'public',
        summary: 'Send a fresh verification link to an unverified account by email (login refused it). Always answers the same, so it never reveals an account.',
        pre: [loginLimiter,],
        input: { body: z.object({ email: z.string().trim().email().max(320,), },), },
        handler: async ({ body, },) => {
            await resendVerificationByEmail(body.email,);
            return { message: 'If that address has an unverified account, a new verification link is on its way.', };
        },
    },),

    defineRoute({
        method: 'post', path: '/forgot-password', auth: 'public',
        summary: 'Request a password-reset link. Always succeeds (never reveals whether the account exists).',
        input: { body: forgotPasswordSchema, },
        handler: async ({ body, },) => {
            await requestPasswordReset(body.email,);
            // One fixed answer for every outcome — found, missing, banned or
            // OAuth-only. See services/auth/passwordReset for why.
            return {
                message:
                    'If an account exists for that address, a password reset link is on its way.',
            };
        },
    },),

    defineRoute({
        method: 'post', path: '/reset-password', auth: 'public',
        summary: 'Set a new password from a reset token; logs the user in (sets auth cookies).',
        input: { body: resetPasswordSchema, },
        handler: async ({ body, req, res, },) => {
            let user;
            try {
                user = await resetPassword(body.token, body.password,);
            } catch (err) {
                if (err instanceof ResetTokenInvalidError) {
                    throw new AppError(400, 'INVALID_TOKEN', err.message,);
                }
                throw err;
            }

            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];
            const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);
            await createSession(user.id, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);
            setAuthCookies(res, { accessToken, refreshToken, },);

            return { user, accessToken, refreshToken, expiresAt, };
        },
    },),

    defineRoute({
        method: 'post', path: '/verify-email', auth: 'public',
        summary: 'Confirm an email-verification token; logs the user in (sets auth cookies).',
        input: { body: verifyEmailSchema, },
        handler: async ({ body, req, res, },) => {
            const user = await verifyEmailToken(body.token,);
            if (!user) {
                throw new AppError(
                    400, 'INVALID_TOKEN',
                    'This verification link is invalid or has already been used.',
                );
            }

            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];
            const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);
            await createSession(user.id, accessToken, refreshToken, expiresAt, ipAddress, userAgent,);

            setAuthCookies(res, { accessToken, refreshToken, },);

            return { user, accessToken, refreshToken, expiresAt, };
        },
    },),

    defineRoute({
        method: 'post', path: '/refresh', auth: 'public',
        summary: 'Exchange a refresh token for fresh tokens. Sets new auth cookies.',
        input: { body: refreshSchema, },
        handler: async ({ body, req, res, },) => {
            const refreshToken = body.refreshToken || req.cookies?.refreshToken;

            if (!refreshToken) {
                throw new UnauthorizedError('No refresh token provided',);
            }

            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];

            let rememberMe = false;
            let authResponse;
            try {
                // `rememberMe` (decoded from the incoming refresh token) sizes
                // the reissued refresh cookie; it is not part of the wire DTO.
                ({ rememberMe, ...authResponse } = await refreshTokens(refreshToken, ipAddress, userAgent,));
            } catch (error) {
                logger.error('Token refresh error', { error, },);
                throw new UnauthorizedError('Invalid or expired refresh token',);
            }

            setAuthCookies(res, authResponse, {
                refreshMaxAge: rememberMe ? REFRESH_COOKIE_REMEMBER_MS : REFRESH_COOKIE_MAX_AGE_MS,
            },);

            return authResponse;
        },
    },),

    defineRoute({
        method: 'post', path: '/logout', auth: 'public',
        summary: 'Invalidate the current session token and clear auth cookies.',
        handler: async ({ req, res, },) => {
            try {
                const token = req.cookies?.accessToken || req.headers.authorization?.slice(7,);

                if (token) {
                    await invalidateSession(token,);
                }

                res.clearCookie('accessToken',);
                res.clearCookie('refreshToken',);

                return { message: 'Logged out successfully', };
            } catch (error) {
                logger.error('Logout error', { error, },);
                return { message: 'Logged out', };
            }
        },
    },),

    defineRoute({
        method: 'post', path: '/logout-all', auth: 'user',
        summary: 'Invalidate every session for the current user and clear auth cookies.',
        handler: async ({ userId, res, },) => {
            if (userId) {
                await invalidateAllUserSessions(userId,);
            }

            res.clearCookie('accessToken',);
            res.clearCookie('refreshToken',);

            return { message: 'Logged out of all sessions', };
        },
    },),

    defineRoute({
        method: 'get', path: '/autologin', auth: 'public',
        summary: 'Dev-only: mint an admin session when AUTOLOGIN_ADMIN_LOCALHOST and the caller is localhost.',
        handler: async ({ req, res, },) => {
            if (!config.autologinAdminLocalhost) {
                throw new AppError(404, 'NOT_FOUND', 'Not found',);
            }

            const ip = clientIp(req.headers, req.ip,) || '';
            if (!isLocalhostIp(ip,)) {
                throw new AppError(403, 'FORBIDDEN', 'Not localhost',);
            }

            let result;
            try {
                result = await autologinAdmin(ip, req.headers['user-agent'],);
            } catch {
                throw new AppError(500, 'INTERNAL_ERROR', 'Autologin failed',);
            }
            if (!result) {
                throw new AppError(404, 'NOT_FOUND', 'No admin user found',);
            }

            const { user, accessToken, refreshToken, } = result;

            setAuthCookies(res, { accessToken, refreshToken, }, { secure: false, },);

            return { user, accessToken, refreshToken, };
        },
    },),

    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'Return the currently-authenticated user.',
        handler: async ({ user, },) => {
            // An account created before handles existed gets one on first read.
            if (user && !user.handle) user.handle = await ensureHandle(user.id,).catch(() => null);
            return { user, access: await accessState(user,), loginRoute: await loginRouteForUser(user,), };
        },
    },),

    defineRoute({
        method: 'put', path: '/me', auth: 'user',
        summary: 'Update the current user\'s own profile (name, bio, city/state). Gated by `users`.',
        input: { body: updateProfileSchema, },
        handler: async ({ user, body, audit, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            if (!(await isFeatureEnabledServer('users',))) {
                throw new ForbiddenError('User profiles are not enabled.',);
            }
            // Split base user columns from CRM contact fields (the latter are
            // NOT columns on `users` — they mirror onto the linked contact row).
            const {
                mobilePhone, primaryPhone, streetAddress1, streetAddress2, zip, country, timeZone,
                dateOfBirth, handle, ...base
            } = body;
            // Handle first: a taken handle (409) must not half-apply the rest.
            if (handle !== undefined && handle.trim().toLowerCase() !== (user.handle ?? '').toLowerCase()) {
                await setHandle(user.id, handle,);
            }
            const updated = await usersService.update(user.id, base, audit(),);

            // When Contacts (CRM) is on, ensure this user has a contact row and
            // mirror the saved profile + contact fields onto it (redundant name/
            // city/state included by design).
            if (await isFeatureEnabledServer('contacts',)) {
                await contactsService.upsertForUser(
                    { id: user.id, email: user.email, },
                    {
                        firstName: base.firstName, lastName: base.lastName, email: user.email,
                        mobilePhone, primaryPhone, streetAddress1, streetAddress2,
                        city: base.locationCity, zip, state: base.locationState, country, timeZone,
                        // Admin-added custom field — only written where the column
                        // exists; the service drops unknown keys.
                        ...(dateOfBirth !== undefined ? { dateOfBirth, } : {}),
                    },
                    user.id,
                );
            }
            return { user: updated, };
        },
    },),

    defineRoute({
        method: 'post', path: '/me/avatar', auth: 'user',
        summary: 'Upload the current user\'s own avatar (resized to 512×512 webp, stored on the CDN). Gated by `users`.',
        pre: [avatarUpload.single('avatar',),],
        handler: async ({ user, req, audit, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            if (!(await isFeatureEnabledServer('users',))) {
                throw new ForbiddenError('User profiles are not enabled.',);
            }
            const file = req.file;
            if (!file) throw new AppError(400, 'BAD_REQUEST', 'No file uploaded',);
            const updated = await usersService.setAvatar(user.id, file.path, audit(),);
            return { user: updated, };
        },
    },),

    defineRoute({
        method: 'delete', path: '/me/avatar', auth: 'user',
        summary: 'Remove the current user\'s avatar (also deletes the stored file). Gated by `users`.',
        handler: async ({ user, audit, },) => {
            if (!user) throw new UnauthorizedError('Not authenticated',);
            if (!(await isFeatureEnabledServer('users',))) {
                throw new ForbiddenError('User profiles are not enabled.',);
            }
            const updated = await usersService.clearAvatar(user.id, audit(),);
            return { user: updated, };
        },
    },),

    defineRoute({
        method: 'post', path: '/patreon/sync', auth: 'user',
        summary: 'Re-sync the current user\'s Patreon membership from the Patreon API.',
        handler: async ({ user, },) => {
            if (!user || !user.patreonId) {
                throw new AppError(400, 'BAD_REQUEST', 'No Patreon account linked',);
            }

            const membership = await syncPatreonMembership(user.id,);
            return { membership, };
        },
    },),
];
