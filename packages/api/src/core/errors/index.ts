/**
 * Framework-agnostic error types. The Express error handler in
 * middleware/error.ts re-exports these (for now) so legacy imports keep
 * working; new code should import from '@/core/errors'.
 */

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

/**
 * 403 for a gate the viewer can pass by signing in or subscribing. The client
 * shows the message + a link (sign in / upgrade) from `details`
 * (`AccessRequiredDetails`: reason, requiredTier).
 */
export class AccessRequiredError extends AppError {
    constructor(reason: 'signin' | 'subscribe', requiredTier: { id: string; name: string; } | null, message?: string,) {
        super(
            403,
            reason === 'signin' ? 'SIGN_IN_REQUIRED' : 'SUBSCRIPTION_REQUIRED',
            message ?? (reason === 'signin'
                ? 'Please sign in to continue.'
                : `This requires ${requiredTier ? `the ${requiredTier.name} subscription or higher` : 'a subscription'}.`),
            { reason, requiredTier, },
        );
    }
}

export class ConflictError extends AppError {
    constructor(message: string, details?: Record<string, unknown>,) {
        super(409, 'CONFLICT', message, details,);
    }
}

export class RateLimitError extends AppError {
    constructor() {
        super(429, 'RATE_LIMITED', 'Too many requests, please try again later',);
    }
}

/** Thrown by service-layer code when a feature is invoked without its config. */
export class ServiceNotConfiguredError extends AppError {
    constructor(serviceName: string,) {
        super(
            503,
            'SERVICE_NOT_CONFIGURED',
            `${serviceName} is not configured on this installation`,
            { service: serviceName, },
        );
    }
}

/** Setup-specific: thrown when an install attempt runs against an already-installed instance. */
export class AlreadyInstalledError extends AppError {
    constructor() {
        super(409, 'ALREADY_INSTALLED', 'This instance is already installed',);
    }
}
