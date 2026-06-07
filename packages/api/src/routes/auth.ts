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
import rateLimit from 'express-rate-limit';
import { z, } from 'zod';
import { config, } from '../config';
import { defineRoute, reply, } from '../api/defineRoute';
import { AppError, UnauthorizedError, } from '../core/errors';
import {
    authenticateWithEmail,
    authenticateWithPatreon,
    autologinAdmin,
    clientIp,
    generateState,
    getPatreonAuthUrl,
    invalidateAllUserSessions,
    invalidateSession,
    isLocalhostIp,
    refreshTokens,
    syncPatreonMembership,
} from '../services/auth';
import { logger, } from '../utils/logger';

// ─── Schemas ──────────────────────────────────────────────────────

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1,),
    /** When true, the refresh-token cookie is set with a 30-day lifetime
     * instead of the default 7. Persistence is purely a cookie-lifetime
     * concern; the server-side session row keeps its normal expiry. */
    rememberMe: z.boolean().optional(),
},);

const refreshSchema = z.object({
    refreshToken: z.string(),
},);

// ─── Cookie helpers ───────────────────────────────────────────────
// maxAge values mirror the pre-framework route handlers exactly.

/** Refresh-token cookie lifetimes (ms — what Express's cookie.maxAge wants). */
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_COOKIE_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

// ─── Rate limiter (attached via `pre`) ────────────────────────────

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: {
        success: false,
        error: {
            code: 'RATE_LIMITED',
            message: 'Too many login attempts. Please try again in 15 minutes.',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req,) => req.ip || 'unknown',
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

                res.cookie('accessToken', authResponse.accessToken, {
                    httpOnly: true,
                    secure: config.isProduction,
                    sameSite: 'lax',
                    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
                },);

                res.cookie('refreshToken', authResponse.refreshToken, {
                    httpOnly: true,
                    secure: config.isProduction,
                    sameSite: 'lax',
                    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
                },);

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
                authResponse = await authenticateWithEmail(body.email, body.password, ipAddress, userAgent,);
            } catch (error) {
                logger.error('Login error', { error, },);
                throw new UnauthorizedError(error instanceof Error ? error.message : 'Login failed',);
            }

            // Access token cookie always has the same short lifetime;
            // remember-me only affects the refresh cookie.
            res.cookie('accessToken', authResponse.accessToken, {
                httpOnly: true,
                secure: config.isProduction,
                sameSite: 'lax',
                maxAge: ACCESS_COOKIE_MAX_AGE_MS,
            },);

            res.cookie('refreshToken', authResponse.refreshToken, {
                httpOnly: true,
                secure: config.isProduction,
                sameSite: 'lax',
                maxAge: body.rememberMe ? REFRESH_COOKIE_REMEMBER_MS : REFRESH_COOKIE_MAX_AGE_MS,
            },);

            return authResponse;
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

            let authResponse;
            try {
                authResponse = await refreshTokens(refreshToken, ipAddress, userAgent,);
            } catch (error) {
                logger.error('Token refresh error', { error, },);
                throw new UnauthorizedError('Invalid or expired refresh token',);
            }

            res.cookie('accessToken', authResponse.accessToken, {
                httpOnly: true,
                secure: config.isProduction,
                sameSite: 'lax',
                maxAge: ACCESS_COOKIE_MAX_AGE_MS,
            },);

            res.cookie('refreshToken', authResponse.refreshToken, {
                httpOnly: true,
                secure: config.isProduction,
                sameSite: 'lax',
                maxAge: REFRESH_COOKIE_MAX_AGE_MS,
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

            res.cookie('accessToken', accessToken, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: ACCESS_COOKIE_MAX_AGE_MS,
            },);

            res.cookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: false,
                sameSite: 'lax',
                maxAge: REFRESH_COOKIE_MAX_AGE_MS,
            },);

            return { user, accessToken, refreshToken, };
        },
    },),

    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'Return the currently-authenticated user.',
        handler: ({ user, },) => ({ user, }),
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
