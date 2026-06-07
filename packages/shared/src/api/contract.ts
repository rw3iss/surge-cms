/**
 * Wire contract shared by the backend, the bundled frontend, and any
 * future client SDK. Every /api/v1 endpoint responds in this envelope.
 */

export interface ApiResponse<T = unknown,> {
    success: boolean;
    data?: T;
    error?: ApiError;
    meta?: ApiMeta;
}

export interface ApiError {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
}

export interface ApiMeta {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
}

export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface SearchParams extends PaginationParams {
    query?: string;
    filters?: Record<string, unknown>;
}

export interface CacheInfo {
    cached: boolean;
    cachedAt?: Date;
    expiresAt?: Date;
    etag?: string;
}

/**
 * Every error code the API emits. Clients switch on these — adding a
 * code is fine, renaming or removing one is a breaking change.
 *
 * Note: the old `DUPLICATE` and `REFERENCE_ERROR` codes (emitted by the
 * legacy per-route handler) are consolidated into `CONFLICT` and
 * `BAD_REQUEST` as routes migrate to the manifest framework.
 */
export const ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'CONFLICT',
    'RATE_LIMITED',
    'BAD_REQUEST',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
    'CSRF_ERROR',
    'CONTENT_LOCKED',
    'SERVICE_NOT_CONFIGURED',
    'ALREADY_INSTALLED',
    // Legacy codes emitted by response.ts PG-error handlers; consolidate
    // into CONFLICT / BAD_REQUEST as routes migrate.
    'DUPLICATE',
    'REFERENCE_ERROR',
    // Font upload route; consolidate into BAD_REQUEST as routes migrate.
    'NO_FILE',
    // Client-side synthetic codes (network layer in frontend/src/services/api.ts).
    'NETWORK_ERROR',
    'UPLOAD_ERROR',
    'TIMEOUT',
    'UNKNOWN_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** @deprecated use ErrorCode */
export type ApiErrorCode = ErrorCode;

export interface FieldValidationError {
    field: string;
    message: string;
    code: string;
}

/**
 * Compile-time assertion that the backend's zod-inferred type `A` is
 * assignable to the published DTO `B`. Used in route files to bind a
 * coercion-bearing query/body schema to its DTO without an awkward
 * `satisfies z.ZodType<...>` (zod coercion makes input ≠ output, which
 * defeats `satisfies`). Resolves to `true` when compatible; a mismatch
 * is a type error at the `type _Assert... = AssertCompatible<...>` line.
 *
 *   type _Assert = AssertCompatible<z.infer<typeof listQuery>, PostListQuery>;
 */
export type AssertCompatible<A extends B, B,> = true;
