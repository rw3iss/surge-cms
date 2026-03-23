export interface ApiResponse<T = unknown,> {
    success: boolean;
    data?: T;
    error?: ApiError;
    meta?: ApiMeta;
}

export interface ApiError {
    code: string;
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

export type ApiErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'VALIDATION_ERROR'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR'
    | 'SERVICE_UNAVAILABLE'
    | 'BAD_REQUEST';

export interface ValidationError {
    field: string;
    message: string;
    code: string;
}
