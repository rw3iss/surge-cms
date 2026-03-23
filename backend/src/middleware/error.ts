import { NextFunction, Request, Response, } from 'express';
import { ZodError, } from 'zod';
import { config, } from '../config';
import { logger, } from '../utils/logger';

export class AppError extends Error {
    constructor(
        public statusCode: number,
        public code: string,
        message: string,
        public details?: Record<string, unknown>,
    ) {
        super(message,);
        this.name = 'AppError';
        Error.captureStackTrace(this, this.constructor,);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string,) {
        super(404, 'NOT_FOUND', `${resource} not found`,);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: Record<string, unknown>,) {
        super(400, 'VALIDATION_ERROR', message, details,);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized',) {
        super(401, 'UNAUTHORIZED', message,);
    }
}

export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden',) {
        super(403, 'FORBIDDEN', message,);
    }
}

export class ConflictError extends AppError {
    constructor(message: string,) {
        super(409, 'CONFLICT', message,);
    }
}

export class RateLimitError extends AppError {
    constructor() {
        super(429, 'RATE_LIMITED', 'Too many requests, please try again later',);
    }
}

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
