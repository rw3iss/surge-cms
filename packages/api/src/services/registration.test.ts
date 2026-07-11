import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db', () => ({
    query: (...args: unknown[]) => queryMock(...args),
    transaction: async (cb: (client: { query: typeof queryMock; }) => unknown,) => cb({ query: queryMock, },),
}),);

const logAuditMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./audit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a), }),);

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('HASHED',), }, }),);

import { ConflictError, } from '../core/errors';
import { registerMember, } from './auth';

describe('registerMember', () => {
    beforeEach(() => {
        queryMock.mockReset();
        logAuditMock.mockClear();
    });

    it('creates a member-role email account and returns { userId, email }', async () => {
        queryMock
            .mockResolvedValueOnce({ rows: [], },) // ban check
            .mockResolvedValueOnce({ rows: [], },) // duplicate check
            .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'new@example.com', },], },); // insert

        const out = await registerMember({ name: 'New User', email: 'New@Example.com', password: 'password1', },);

        expect(out,).toEqual({ userId: 'u1', email: 'new@example.com', },);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO users',),
        );
        expect(insertCall,).toBeDefined();
        expect((insertCall![0] as string).includes('\'member\'',),).toBe(true,);
        expect((insertCall![0] as string).includes('\'email\'',),).toBe(true,);
        // email normalized to lowercase, name trimmed.
        expect(insertCall![1],).toEqual(['new@example.com', 'HASHED', 'New User',],);
        expect(logAuditMock,).toHaveBeenCalledTimes(1,);
    },);

    it('rejects a duplicate email with ConflictError', async () => {
        queryMock
            .mockResolvedValueOnce({ rows: [], },) // ban check
            .mockResolvedValueOnce({ rows: [{ '?column?': 1, },], },); // duplicate found

        await expect(registerMember({ name: 'Dupe', email: 'dupe@example.com', password: 'password1', },),)
            .rejects.toBeInstanceOf(ConflictError,);
    },);

    it('rejects a banned email', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ '?column?': 1, },], },); // ban check hits

        await expect(registerMember({ name: 'Banned', email: 'banned@example.com', password: 'password1', },),)
            .rejects.toBeInstanceOf(ConflictError,);
    },);
},);
