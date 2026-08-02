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
import type { Response, } from 'express';
import rateLimit, { ipKeyGenerator, } from 'express-rate-limit';
import { z, } from 'zod';
import type {
    AuthLoginBody,
    AuthRefreshBody,
    AuthRegisterBody,
    AuthUpdateProfileBody,
    AuthVerifyEmailBody,
} from '@sitesurge/types';
import { config, } from '../config';
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
    syncPatreonMembership,
    verifyEmailToken,
} from '../services/auth';
import { isFeatureEnabledServer, } from '../services/settings';
import * as usersService from '../services/users';
import { avatarUpload, } from './users';
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
},) satisfies z.ZodType<AuthRegisterBody>;

const verifyEmailSchema = z.object({
    token: z.string().min(1,),
},) satisfies z.ZodType<AuthVerifyEmailBody>;

const updateProfileSchema = z.object({
    firstName: z.string().max(100,).nullish(),
    lastName: z.string().max(100,).nullish(),
    bio: z.string().max(250,).nullish(),
    locationCity: z.string().max(100,).nullish(),
    locationState: z.string().max(100,).nullish(),
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

export const authRoutes = [

    defineRoute({
        method: 'get', path: '/patreon', auth: 'public',
        summary: 'Generate a Patreon OAuth authorization URL + state.',
        handler: () => {
            const state = generateState();
            return { authUrl: getPatreonAuthUrl(state,), state, };
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
                throw new UnauthorizedError(error instanceof Error ? error.message : 'Login failed',);
            }

            // Access token cookie always has the same short lifetime;
            // remember-me only affects the refresh cookie.
            setAuthCookies(res, authResponse, {
                refreshMaxAge: body.rememberMe ? REFRESH_COOKIE_REMEMBER_MS : REFRESH_COOKIE_MAX_AGE_MS,
            },);

            return authResponse;
        },
    },),

    defineRoute({
        method: 'post', path: '/register', auth: 'public',
        summary: 'Public member self-registration (gated behind the `users` feature). No auto-login.',
        pre: [loginLimiter,],
        input: { body: registerSchema, },
        handler: async ({ body, req, },) => {
            if (!(await isFeatureEnabledServer('users',))) {
                throw new ForbiddenError('Public registration is not enabled.',);
            }

            const ipAddress = clientIp(req.headers, req.ip,);
            const userAgent = req.headers['user-agent'];

            return registerMember(
                { name: body.name, email: body.email, password: body.password, },
                { ipAddress, userAgent, },
            );
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
        handler: ({ user, },) => ({ user, }),
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
            const updated = await usersService.update(user.id, body, audit(),);
            return { user: updated, };
        },
    },),

    defineRoute({
        method: 'post', path: '/me/avatar', auth: 'user',
        summary: 'Upload the current user\'s own avatar (resized to 256×256 webp). Gated by `users`.',
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
