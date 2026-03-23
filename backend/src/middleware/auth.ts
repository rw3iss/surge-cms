import type { User, UserRole, } from '@surge/shared';
import { NextFunction, Request, Response, } from 'express';
import jwt from 'jsonwebtoken';
import { config, } from '../config';
import { query, } from '../db';
import { mapRow, } from '../utils/mapRow';

export interface AuthenticatedRequest extends Request {
    user?: User;
    userId?: string;
}

interface JwtPayload {
    userId: string;
    role: UserRole;
    iat: number;
    exp: number;
}

export function authenticate(required = true,) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction,) => {
        try {
            const authHeader = req.headers.authorization;
            const token = authHeader?.startsWith('Bearer ',) ?
                authHeader.slice(7,) :
                req.cookies?.accessToken;

            if (!token) {
                if (required) {
                    return res.status(401,).json({
                        success: false,
                        error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
                    },);
                }
                return next();
            }

            const decoded = jwt.verify(token, config.jwt.secret,) as JwtPayload;

            const result = await query(
                `SELECT id, email, display_name, avatar_url, role, auth_provider,
                patreon_id, patreon_tier, is_active, is_banned,
                last_login_at, created_at, updated_at
         FROM users WHERE id = $1`,
                [decoded.userId,],
            );

            const row = result.rows[0] as Record<string, unknown> | undefined;

            if (!row) {
                if (required) {
                    return res.status(401,).json({
                        success: false,
                        error: { code: 'UNAUTHORIZED', message: 'User not found', },
                    },);
                }
                return next();
            }

            if (!row.is_active || row.is_banned) {
                return res.status(403,).json({
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'Account is disabled or banned', },
                },);
            }

            req.user = mapRow<User>(row,);
            req.userId = row.id as string;

            next();
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                return res.status(401,).json({
                    success: false,
                    error: { code: 'UNAUTHORIZED', message: 'Token expired', },
                },);
            }

            if (error instanceof jwt.JsonWebTokenError) {
                return res.status(401,).json({
                    success: false,
                    error: { code: 'UNAUTHORIZED', message: 'Invalid token', },
                },);
            }

            if (required) {
                return res.status(401,).json({
                    success: false,
                    error: { code: 'UNAUTHORIZED', message: 'Authentication failed', },
                },);
            }

            next();
        }
    };
}

export function requireRole(...roles: UserRole[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction,) => {
        if (!req.user) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
            },);
        }

        if (!roles.includes(req.user.role,)) {
            return res.status(403,).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Insufficient permissions', },
            },);
        }

        next();
    };
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction,) {
    return requireRole('admin',)(req, res, next,);
}
