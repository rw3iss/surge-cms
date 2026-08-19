import { describe, expect, it, } from 'vitest';
import { mapRow, mapRows, SENSITIVE_COLUMNS, } from './mapRow';

/**
 * `mapRow` is the single funnel DB rows pass through on their way to an API
 * response, so it is where secret columns get dropped. These tests are the
 * regression guard: `passwordHash` was previously serialised into the
 * `POST /auth/login` response body because the login query mapped the whole
 * `users` row.
 */
describe('mapRow — sensitive column stripping', () => {
    it('drops password_hash from a mapped row', () => {
        const mapped = mapRow<Record<string, unknown>>({
            id: 'u1',
            email: 'a@b.c',
            password_hash: '$2a$12$super-secret-hash',
            display_name: 'Ryan',
        },);

        expect(mapped,).not.toHaveProperty('passwordHash',);
        expect(mapped,).not.toHaveProperty('password_hash',);
        expect(JSON.stringify(mapped,),).not.toContain('super-secret-hash',);
        // …while everything else still maps normally.
        expect(mapped.displayName,).toBe('Ryan',);
        expect(mapped.email,).toBe('a@b.c',);
    },);

    it('drops every declared sensitive column', () => {
        const row: Record<string, unknown> = { id: 'u1', };
        for (const col of SENSITIVE_COLUMNS) row[col] = `secret-${col}`;

        const mapped = mapRow<Record<string, unknown>>(row,);

        expect(Object.keys(mapped,),).toEqual(['id',],);
        expect(JSON.stringify(mapped,),).not.toContain('secret-',);
    },);

    it('strips them in mapRows too (list endpoints)', () => {
        const mapped = mapRows<Record<string, unknown>>([
            { id: 'u1', password_hash: 'h1', verification_token: 't1', },
            { id: 'u2', password_hash: 'h2', verification_token: 't2', },
        ],);

        expect(mapped,).toHaveLength(2,);
        for (const m of mapped) {
            expect(m,).not.toHaveProperty('passwordHash',);
            expect(m,).not.toHaveProperty('verificationToken',);
        }
        expect(JSON.stringify(mapped,),).not.toContain('h1',);
    },);

    it('still converts _at columns to Date', () => {
        const mapped = mapRow<Record<string, unknown>>({
            id: 'u1',
            created_at: '2026-01-02T03:04:05.000Z',
            password_hash: 'nope',
        },);

        expect(mapped.createdAt,).toBeInstanceOf(Date,);
        expect(mapped,).not.toHaveProperty('passwordHash',);
    },);

    it('leaves rows without sensitive columns untouched', () => {
        const mapped = mapRow<Record<string, unknown>>({ id: 'p1', page_title: 'Home', },);
        expect(mapped,).toEqual({ id: 'p1', pageTitle: 'Home', },);
    },);
},);
