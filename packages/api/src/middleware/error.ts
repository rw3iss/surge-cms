import { NextFunction, Request, Response, } from 'express';
import { ZodError, } from 'zod';
import { config, } from '../config';
import { logger, } from '../utils/logger';

// Error classes live in core/errors/ for framework-agnosticism. This
// module re-exports them so existing imports
// (`from '../middleware/error'`) keep working while new code targets
// '@/core/errors'.
export {
    AppError,
    NotFoundError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    ConflictError,
    RateLimitError,
    ServiceNotConfiguredError,
    AlreadyInstalledError,
} from '../core/errors';

import { AppError, } from '../core/errors';

export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction,
) {
    logger.error('Error handling request', {
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    },);

    if (err instanceof AppError) {
        return res.status(err.statusCode,).json({
            success: false,
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
            },
        },);
    }

    if (err instanceof ZodError) {
        return res.status(400,).json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid request data',
                details: {
                    errors: err.errors.map((e,) => ({
                        field: e.path.join('.',),
                        message: e.message,
                        code: e.code,
                    })),
                },
            },
        },);
    }

    // Database errors
    if ((err as NodeJS.ErrnoException).code === '23505') {
        return res.status(409,).json({
            success: false,
            error: {
                code: 'CONFLICT',
                message: 'A resource with this identifier already exists',
            },
        },);
    }

    if ((err as NodeJS.ErrnoException).code === '23503') {
        return res.status(400,).json({
            success: false,
            error: {
                code: 'BAD_REQUEST',
                message: 'Referenced resource does not exist',
            },
        },);
    }

    // Generic error
    const statusCode = 500;
    const message = config.isProduction ?
        'Internal server error' :
        err.message || 'Internal server error';

    res.status(statusCode,).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message,
            ...(config.isDevelopment && { stack: err.stack, }),
        },
    },);
}

export function notFoundHandler(req: Request, res: Response,) {
    res.status(404,).json({
        success: false,
        error: {
            code: 'NOT_FOUND',
            message: `Route ${req.method} ${req.path} not found`,
        },
    },);
}
