import { describe, expect, it, } from 'vitest';
import {
    CmsError, NetworkError, NotFoundError, RateLimitedError,
    UnauthorizedError, ValidationError, ContentLockedError, errorFromEnvelope,
} from './errors';

describe('errorFromEnvelope', () => {
    it('maps NOT_FOUND → NotFoundError with status/code', () => {
        const e = errorFromEnvelope(404, { code: 'NOT_FOUND', message: 'Post not found', },);
        expect(e,).toBeInstanceOf(NotFoundError,);
        expect(e,).toBeInstanceOf(CmsError,);
        expect(e.code,).toBe('NOT_FOUND',);
        expect(e.status,).toBe(404,);
        expect(e.message,).toBe('Post not found',);
    },);

    it('maps VALIDATION_ERROR and exposes fieldErrors', () => {
        const e = errorFromEnvelope(400, {
            code: 'VALIDATION_ERROR', message: 'Invalid request data',
            details: { errors: [{ field: 'slug', message: 'Required', code: 'invalid', },], },
        },) as ValidationError;
        expect(e,).toBeInstanceOf(ValidationError,);
        expect(e.fieldErrors,).toEqual({ slug: 'Required', },);
    },);

    it('maps CONTENT_LOCKED and carries the preview details', () => {
        const e = errorFromEnvelope(403, {
            code: 'CONTENT_LOCKED', message: 'Access denied',
            details: { locked: true, accessLevel: 'patron',
                preview: { title: 'T', description: null, featuredImage: null, }, },
        },) as ContentLockedError;
        expect(e,).toBeInstanceOf(ContentLockedError,);
        expect(e.accessLevel,).toBe('patron',);
        expect(e.preview.title,).toBe('T',);
    },);

    it('maps RATE_LIMITED and carries retryAfter', () => {
        const e = errorFromEnvelope(429, { code: 'RATE_LIMITED', message: 'slow down', }, 12,) as RateLimitedError;
        expect(e,).toBeInstanceOf(RateLimitedError,);
        expect(e.retryAfter,).toBe(12,);
    },);

    it('maps UNAUTHORIZED → UnauthorizedError', () => {
        expect(errorFromEnvelope(401, { code: 'UNAUTHORIZED', message: 'x', },),).toBeInstanceOf(UnauthorizedError,);
    },);

    it('unknown code falls back to CmsError', () => {
        const e = errorFromEnvelope(418, { code: 'WEIRD' as never, message: 'teapot', },);
        expect(e.constructor.name,).toBe('CmsError',);
        expect(e.code,).toBe('WEIRD',);
    },);

    it('NetworkError is a CmsError with NETWORK_ERROR code', () => {
        const e = new NetworkError('offline',);
        expect(e,).toBeInstanceOf(CmsError,);
        expect(e.code,).toBe('NETWORK_ERROR',);
    },);
},);
