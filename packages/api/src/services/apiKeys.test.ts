import { describe, expect, it, vi, } from 'vitest';

// Importing './apiKeys' transitively pulls '../db' via the repo module.
// The db pool is lazy, but mocking it (mirroring audit.test.ts) keeps
// these pure-helper tests fully DB-free and side-effect-free.
vi.mock('../db', () => ({ query: vi.fn(), }),);

import { hashKey, KEY_PREFIX, requiredScopeFor, scopeSatisfies, } from './apiKeys';

describe('apiKeys helpers', () => {
    it('scope hierarchy: read < write < admin', () => {
        expect(scopeSatisfies(['read',], 'read',),).toBe(true,);
        expect(scopeSatisfies(['read',], 'write',),).toBe(false,);
        expect(scopeSatisfies(['write',], 'read',),).toBe(true,);
        expect(scopeSatisfies(['write',], 'admin',),).toBe(false,);
        expect(scopeSatisfies(['admin',], 'write',),).toBe(true,);
        expect(scopeSatisfies([], 'read',),).toBe(false,);
    });

    it('maps methods to required scopes', () => {
        expect(requiredScopeFor('GET',),).toBe('read',);
        expect(requiredScopeFor('HEAD',),).toBe('read',);
        expect(requiredScopeFor('POST',),).toBe('write',);
        expect(requiredScopeFor('PUT',),).toBe('write',);
        expect(requiredScopeFor('DELETE',),).toBe('write',);
    },);

    it('hashes deterministically to 64 hex chars', () => {
        const h = hashKey(`${KEY_PREFIX}abc`,);
        expect(h,).toMatch(/^[0-9a-f]{64}$/,);
        expect(hashKey(`${KEY_PREFIX}abc`,),).toBe(h,);
    },);
},);
