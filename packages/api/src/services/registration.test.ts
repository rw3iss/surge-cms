import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db', () => ({
    query: (...args: unknown[]) => queryMock(...args),
    transaction: async (cb: (client: { query: typeof queryMock; }) => unknown,) => cb({ query: queryMock, },),
}),);

const logAuditMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./audit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a), }),);

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('HASHED',), }, }),);

// Email-verification settings + sender are stubbed so registerMember doesn't
// touch the settings store / mail pipeline. The settings flag is reconfigured
// per-test to cover both the verification-off and verification-on paths.
const getUsersSettingsMock = vi.fn();
vi.mock('./settings', () => ({
    getUsersSettings: (...a: unknown[]) => getUsersSettingsMock(...a),
}),);
const sendVerificationEmailMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./mail/verification', () => ({
    generateVerificationToken: () => 'TOK',
    sendVerificationEmail: (...a: unknown[]) => sendVerificationEmailMock(...a),
}),);

import { ConflictError, } from '../core/errors';
import { registerMember, } from './auth';

describe('registerMember', () => {
    beforeEach(() => {
        queryMock.mockReset();
        logAuditMock.mockClear();
        sendVerificationEmailMock.mockClear();
        getUsersSettingsMock.mockResolvedValue({
            requireEmailVerification: false,
            verificationEmail: { subject: '', blocks: [], },
        },);
    });

    it('creates a verified member when verification is off; no email sent', async () => {
        queryMock
            .mockResolvedValueOnce({ rows: [], },) // ban check
            .mockResolvedValueOnce({ rows: [], },) // duplicate check
            .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'new@example.com', },], },); // insert

        const out = await registerMember({ name: 'New User', email: 'New@Example.com', password: 'password1', },);

        expect(out,).toEqual({ userId: 'u1', email: 'new@example.com', verificationRequired: false, },);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO users',),
        );
        expect(insertCall,).toBeDefined();
        expect((insertCall![0] as string).includes('\'member\'',),).toBe(true,);
        expect((insertCall![0] as string).includes('\'email\'',),).toBe(true,);
        // email normalized to lowercase, name trimmed, email_verified=true, no token.
        expect(insertCall![1],).toEqual(['new@example.com', 'HASHED', 'New User', true, null,],);
        expect(sendVerificationEmailMock,).not.toHaveBeenCalled();
        expect(logAuditMock,).toHaveBeenCalledTimes(1,);
    },);

    it('creates an unverified member + sends a verification email when verification is on', async () => {
        getUsersSettingsMock.mockResolvedValue({
            requireEmailVerification: true,
            verificationEmail: { subject: '', blocks: [], },
        },);
        queryMock
            .mockResolvedValueOnce({ rows: [], },) // ban check
            .mockResolvedValueOnce({ rows: [], },) // duplicate check
            .mockResolvedValueOnce({ rows: [{ id: 'u2', email: 'v@example.com', },], },); // insert

        const out = await registerMember({ name: 'Verify Me', email: 'v@example.com', password: 'password1', },);

        expect(out,).toEqual({ userId: 'u2', email: 'v@example.com', verificationRequired: true, },);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO users',),
        );
        // email_verified=false, token stored.
        expect(insertCall![1],).toEqual(['v@example.com', 'HASHED', 'Verify Me', false, 'TOK',],);
        expect(sendVerificationEmailMock,).toHaveBeenCalledTimes(1,);
        expect(sendVerificationEmailMock,).toHaveBeenCalledWith(
            { email: 'v@example.com', name: 'Verify Me', }, 'TOK',
        );
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
