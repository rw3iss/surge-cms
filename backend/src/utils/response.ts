/**
 * Standardized API response helpers.
 * Ensures all endpoints return consistent ApiResponse format.
 */
import { Response, } from 'express';
import { z, } from 'zod';
import { AppError, NotFoundError, ValidationError, } from '../middleware/error';
import { logger, } from './logger';

interface ApiMeta {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
}

export function sendSuccess<T,>(res: Response, data: T, meta?: ApiMeta, status = 200,): void {
    const response: Record<string, unknown> = { success: true, data, };
    if (meta) response.meta = meta;
    res.status(status,).json(response,);
}

export function sendCreated<T,>(res: Response, data: T,): void {
    sendSuccess(res, data, undefined, 201,);
}

export function sendPaginated<T,>(
    res: Response,
    data: T[],
    page: number,
    limit: number,
    total: number,
): void {
    sendSuccess(res, data, {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit,),
    },);
}

export function sendError(res: Response, code: string, message: string, status = 500, details?: unknown,): void {
    const response: Record<string, unknown> = {
        success: false,
        error: { code, message, },
    };
    if (details) (response.error as Record<string, unknown>).details = details;
    res.status(status,).json(response,);
}

/**
 * Centralized error handler for route handlers.
 * Catches common error types and sends appropriate responses.
 */
export function handleRouteError(res: Response, error: unknown, context: string,): void {
    if (error instanceof NotFoundError) {
        sendError(res, 'NOT_FOUND', error.message, 404,);
        return;
    }

    if (error instanceof ValidationError) {
        sendError(res, 'VALIDATION_ERROR', error.message, 400,);
        return;
    }

    if (error instanceof z.ZodError) {
        sendError(res, 'VALIDATION_ERROR', 'Invalid data', 400, error.errors,);
        return;
    }

    if (error instanceof AppError) {
        sendError(res, error.code, error.message, error.statusCode,);
        return;
    }

    // PostgreSQL duplicate key
    const pgError = error as { code?: string; detail?: string; };
    if (pgError?.code === '23505') {
        const detail = pgError.detail || '';
        const field = detail.includes('slug',) ? 'slug' : detail.includes('email',) ? 'email' : 'field';
        sendError(res, 'DUPLICATE', `A record with this ${field} already exists`, 409,);
        return;
    }

    // PostgreSQL foreign key violation
    if (pgError?.code === '23503') {
        sendError(res, 'REFERENCE_ERROR', 'Referenced record does not exist', 400,);
        return;
    }

    logger.error(`Error in ${context}`, { error, },);
    sendError(res, 'INTERNAL_ERROR', `Failed to ${context}`,);
}
