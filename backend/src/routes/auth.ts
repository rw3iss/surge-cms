import { Response, Router, } from 'express';
import rateLimit from 'express-rate-limit';
import { z, } from 'zod';
import { config, } from '../config';
import { authenticate, AuthenticatedRequest, } from '../middleware/auth';
import { query, } from '../db';
import { mapRow, } from '../utils/mapRow';
import {
    authenticateWithEmail,
    authenticateWithPatreon,
    createSession,
    generateState,
    generateTokens,
    getPatreonAuthUrl,
    invalidateAllUserSessions,
    invalidateSession,
    refreshTokens,
    syncPatreonMembership,
} from '../services/auth';
import { logger, } from '../utils/logger';

const router = Router();

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

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1,),
},);

const refreshSchema = z.object({
    refreshToken: z.string(),
},);

// Get Patreon auth URL
router.get('/patreon', (req, res,) => {
    const state = generateState();

    // Store state in session or return to client
    res.json({
        success: true,
        data: {
            authUrl: getPatreonAuthUrl(state,),
            state,
        },
    },);
},);

// Patreon OAuth callback
router.get('/patreon/callback', async (req, res: Response,) => {
    try {
        const { code, state, error, } = req.query;

        if (error) {
            logger.warn('Patreon OAuth error', { error, },);
            return res.redirect(`${config.frontendUrl}/login?error=patreon_denied`,);
        }

        if (!code || typeof code !== 'string') {
            return res.redirect(`${config.frontendUrl}/login?error=no_code`,);
        }

        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip;
        const userAgent = req.headers['user-agent'];

        const authResponse = await authenticateWithPatreon(code, ipAddress, userAgent,);

        // Set cookies
        res.cookie('accessToken', authResponse.accessToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000, // 15 minutes
        },);

        res.cookie('refreshToken', authResponse.refreshToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        },);

        // Redirect to frontend with success
        const redirectUrl = req.cookies?.returnUrl || '/';
        res.clearCookie('returnUrl',);
        res.redirect(`${config.frontendUrl}${redirectUrl}?auth=success`,);
    } catch (error) {
        logger.error('Patreon callback error', { error, },);
        res.redirect(`${config.frontendUrl}/login?error=auth_failed`,);
    }
},);

// Email/password login
router.post('/login', loginLimiter, async (req: AuthenticatedRequest, res,) => {
    try {
        const { email, password, } = loginSchema.parse(req.body,);

        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip;
        const userAgent = req.headers['user-agent'];

        const authResponse = await authenticateWithEmail(email, password, ipAddress, userAgent,);

        // Set cookies
        res.cookie('accessToken', authResponse.accessToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000,
        },);

        res.cookie('refreshToken', authResponse.refreshToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },);

        res.json({
            success: true,
            data: authResponse,
        },);
    } catch (error) {
        logger.error('Login error', { error, },);
        res.status(401,).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: error instanceof Error ? error.message : 'Login failed',
            },
        },);
    }
},);

// Refresh token
router.post('/refresh', async (req: AuthenticatedRequest, res,) => {
    try {
        const { refreshToken: bodyToken, } = refreshSchema.parse(req.body,);
        const refreshToken = bodyToken || req.cookies?.refreshToken;

        if (!refreshToken) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'No refresh token provided', },
            },);
        }

        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',',)[0] || req.ip;
        const userAgent = req.headers['user-agent'];

        const authResponse = await refreshTokens(refreshToken, ipAddress, userAgent,);

        // Set new cookies
        res.cookie('accessToken', authResponse.accessToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000,
        },);

        res.cookie('refreshToken', authResponse.refreshToken, {
            httpOnly: true,
            secure: config.isProduction,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },);

        res.json({
            success: true,
            data: authResponse,
        },);
    } catch (error) {
        logger.error('Token refresh error', { error, },);
        res.status(401,).json({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or expired refresh token',
            },
        },);
    }
},);

// Logout
router.post('/logout', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const token = req.cookies?.accessToken || req.headers.authorization?.slice(7,);

        if (token) {
            await invalidateSession(token,);
        }

        res.clearCookie('accessToken',);
        res.clearCookie('refreshToken',);

        res.json({
            success: true,
            data: { message: 'Logged out successfully', },
        },);
    } catch (error) {
        logger.error('Logout error', { error, },);
        res.json({
            success: true,
            data: { message: 'Logged out', },
        },);
    }
},);

// Logout all sessions
router.post('/logout-all', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        if (req.userId) {
            await invalidateAllUserSessions(req.userId,);
        }

        res.clearCookie('accessToken',);
        res.clearCookie('refreshToken',);

        res.json({
            success: true,
            data: { message: 'Logged out of all sessions', },
        },);
    } catch (error) {
        logger.error('Logout all error', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to logout all sessions', },
        },);
    }
},);

// Auto-login as admin from localhost (dev only)
router.get('/autologin', async (req, res,) => {
    if (!config.autologinAdminLocalhost) {
        return res.status(404,).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found', }, },);
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',',)[0]?.trim() || req.ip || '';
    const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost',].includes(ip,);

    if (!isLocalhost) {
        return res.status(403,).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not localhost', }, },);
    }

    try {
        const result = await query(
            `SELECT id, email, display_name, avatar_url, role, auth_provider,
                    patreon_id, patreon_tier, is_active, is_banned,
                    last_login_at, created_at, updated_at
             FROM users WHERE role IN ('sysadmin', 'admin') ORDER BY CASE role WHEN 'sysadmin' THEN 0 ELSE 1 END LIMIT 1`,
        );

        if (result.rows.length === 0) {
            return res.status(404,).json({ success: false, error: { code: 'NOT_FOUND', message: 'No admin user found', }, },);
        }

        const user = mapRow(result.rows[0],) as any;
        const { accessToken, refreshToken, expiresAt, } = generateTokens(user.id, user.role,);
        await createSession(user.id, accessToken, refreshToken, expiresAt, ip, req.headers['user-agent'],);

        res.cookie('accessToken', accessToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000,
        },);

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        },);

        res.json({
            success: true,
            data: { user, accessToken, refreshToken, },
        },);
    } catch (error) {
        res.status(500,).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Autologin failed', }, },);
    }
},);

// Get current user
router.get('/me', authenticate(), (req: AuthenticatedRequest, res,) => {
    res.json({
        success: true,
        data: { user: req.user, },
    },);
},);

// Sync Patreon membership data
router.post('/patreon/sync', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        if (!req.user || !req.user.patreonId) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'No Patreon account linked', },
            },);
        }

        const membership = await syncPatreonMembership(req.user.id,);

        res.json({
            success: true,
            data: { membership, },
        },);
    } catch (error) {
        logger.error('Patreon sync error', { error, },);
        res.status(500,).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: error instanceof Error ? error.message : 'Failed to sync Patreon membership',
            },
        },);
    }
},);

export default router;
