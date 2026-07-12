import type {
    ApiError, ContentLockedDetails, ErrorCode, SettingsFeatureCascadeResult,
} from '@sitesurge/types';

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

/**
 * Thrown by `cms.settings.update()` when PUT /settings rejects a feature
 * toggle on its dependency planner. The backend answers **409** with a
 * NON-STANDARD body — `{ success: false, error: <SettingsFeatureCascadeResult> }`
 * — where `error` is the planner's verbatim refusal (NOT an `{ code, message }`
 * ApiError). `errorFromEnvelope` detects that shape and surfaces it here so
 * the cascade fields survive (the generic envelope path would drop them,
 * since the body has no `code`/`message`/`details`).
 *
 * `result` carries the typed refusal: `kind: 'missing_prerequisites'`
 * (read `result.missing`) or `kind: 'has_dependents'` (read
 * `result.dependents`). Consumers render a confirmation modal and retry
 * `update()` with `enableDependencies: true` / `disableDependents: true`.
 */
export class FeatureCascadeError extends CmsError {
    readonly result: SettingsFeatureCascadeResult;
    constructor(result: SettingsFeatureCascadeResult, status = 409,) {
        super(
            `Feature toggle blocked: ${result.kind} for "${result.target}"`,
            { code: 'CONFLICT', status, details: result as unknown as Record<string, unknown>, },
        );
        this.result = result;
    }
}

/** Type-guard for the non-standard cascade 409 body (`payload.error` is the
 *  planner result itself, not an `{ code, message, details }` ApiError). */
export function isFeatureCascadeResult(v: unknown,): v is SettingsFeatureCascadeResult {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;
    return r.ok === false
        && (r.kind === 'missing_prerequisites' || r.kind === 'has_dependents')
        && typeof r.target === 'string';
}
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
    // Non-standard PUT /settings 409: `error` IS the planner result
    // (`{ ok:false, kind, target, ... }`), not an `{ code, message }`
    // ApiError. Catch it here so the cascade fields aren't lost.
    if (status === 409 && isFeatureCascadeResult(error,)) {
        return new FeatureCascadeError(error, status,);
    }
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
