import type { ApiError, ContentLockedDetails, ErrorCode, } from '@rw/cms-shared';

/** Base class for every error the client throws. Carries the wire code,
 *  HTTP status, and raw details so callers can switch on `code` or
 *  instanceof a subclass. Also emitted on the client error bus. */
export class CmsError extends Error {
    readonly code: ErrorCode | string;
    readonly status: number;
    readonly details?: Record<string, unknown>;
    readonly requestId?: string;

    constructor(
        message: string,
        opts: { code: ErrorCode | string; status: number; details?: Record<string, unknown>; requestId?: string; },
    ) {
        super(message,);
        this.name = new.target.name;
        this.code = opts.code;
        this.status = opts.status;
        this.details = opts.details;
        this.requestId = opts.requestId;
        Object.setPrototypeOf(this, new.target.prototype,);
    }
}

export class BadRequestError extends CmsError {}
export class UnauthorizedError extends CmsError {}
export class ForbiddenError extends CmsError {}
export class NotFoundError extends CmsError {}
export class ConflictError extends CmsError {}
export class ServiceUnavailableError extends CmsError {}
export class InternalError extends CmsError {}

export class ValidationError extends CmsError {
    /** field → first message, derived from details.errors[]. */
    readonly fieldErrors: Record<string, string>;
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; requestId?: string; },) {
        super(message, { code: 'VALIDATION_ERROR', ...opts, },);
        this.fieldErrors = ValidationError.extractFieldErrors(opts.details,);
    }
    private static extractFieldErrors(details?: Record<string, unknown>,): Record<string, string> {
        const out: Record<string, string> = {};
        const errors = (details?.errors ?? []) as Array<{ field?: string; message?: string; }>;
        for (const e of errors) {
            if (e.field && !(e.field in out)) out[e.field] = e.message ?? 'Invalid';
        }
        return out;
    }
}

export class RateLimitedError extends CmsError {
    readonly retryAfter?: number;
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; retryAfter?: number; },) {
        super(message, { code: 'RATE_LIMITED', status: opts.status, details: opts.details, },);
        this.retryAfter = opts.retryAfter;
    }
}

export class ContentLockedError extends CmsError {
    readonly accessLevel: string;
    readonly preview: ContentLockedDetails['preview'];
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; },) {
        super(message, { code: 'CONTENT_LOCKED', status: opts.status, details: opts.details, },);
        const d = (opts.details ?? {}) as Partial<ContentLockedDetails>;
        this.accessLevel = d.accessLevel ?? 'unknown';
        this.preview = d.preview ?? { title: '', description: null, featuredImage: null, };
    }
}

/** Transport-level errors (no HTTP envelope). */
export class NetworkError extends CmsError {
    constructor(message = 'Network request failed',) { super(message, { code: 'NETWORK_ERROR', status: 0, },); }
}
export class TimeoutError extends CmsError {
    constructor(message = 'Request timed out',) { super(message, { code: 'TIMEOUT', status: 0, },); }
}
export class AbortError extends CmsError {
    constructor(message = 'Request aborted',) { super(message, { code: 'UNKNOWN_ERROR', status: 0, },); }
}

/** Build the right subclass from an HTTP status + error envelope. */
export function errorFromEnvelope(status: number, error: ApiError, retryAfter?: number,): CmsError {
    const { code, message, details, } = error;
    const requestId = (details?.requestId as string | undefined);
    const base = { status, details, requestId, };
    switch (code) {
        case 'BAD_REQUEST':
        case 'REFERENCE_ERROR':
        case 'NO_FILE':
            return new BadRequestError(message, { code, ...base, },);
        case 'UNAUTHORIZED':
        case 'CSRF_ERROR':
            return new UnauthorizedError(message, { code, ...base, },);
        case 'FORBIDDEN':
            return new ForbiddenError(message, { code, ...base, },);
        case 'NOT_FOUND':
            return new NotFoundError(message, { code, ...base, },);
        case 'VALIDATION_ERROR':
            return new ValidationError(message, base,);
        case 'CONFLICT':
        case 'DUPLICATE':
        case 'ALREADY_INSTALLED':
            return new ConflictError(message, { code, ...base, },);
        case 'RATE_LIMITED':
            return new RateLimitedError(message, { status, details, retryAfter, },);
        case 'CONTENT_LOCKED':
            return new ContentLockedError(message, base,);
        case 'SERVICE_UNAVAILABLE':
        case 'SERVICE_NOT_CONFIGURED':
            return new ServiceUnavailableError(message, { code, ...base, },);
        case 'INTERNAL_ERROR':
            return new InternalError(message, { code, ...base, },);
        default:
            return new CmsError(message, { code, ...base, },);
    }
}
