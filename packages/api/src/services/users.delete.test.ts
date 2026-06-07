import { beforeEach, describe, expect, it, vi, } from 'vitest';

// Mock the repo so the service test stays DB-free. The service's job is to
// read the row (for the audit snapshot), call repo.deleteUser, bust the
// cache, and audit — we assert that orchestration.
const deleteUserMock = vi.fn().mockResolvedValue(undefined,);
const findUserByIdMock = vi.fn().mockResolvedValue({
    id: 'u1', email: 'gone@example.com', displayName: 'Gone', role: 'member',
},);
vi.mock('../repositories/users.repo', () => ({
    deleteUser: (...args: unknown[]) => deleteUserMock(...args),
    findUserById: (...args: unknown[]) => findUserByIdMock(...args),
}),);

const invalidateUserCacheMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./cache', () => ({ cache: { invalidateUserCache: (...a: unknown[]) => invalidateUserCacheMock(...a), }, }),);

const logAuditMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./audit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a), }),);

import { remove, } from './users';

describe('users.remove', () => {
    beforeEach(() => {
        deleteUserMock.mockClear();
        findUserByIdMock.mockClear();
        invalidateUserCacheMock.mockClear();
        logAuditMock.mockClear();
    },);

    it('deletes the row, busts the cache, and audit-logs a delete with the old snapshot', async () => {
        await remove('u1', { userId: 'admin-1', ipAddress: '1.2.3.4', userAgent: 'test', },);

        expect(findUserByIdMock,).toHaveBeenCalledWith('u1',);
        expect(deleteUserMock,).toHaveBeenCalledWith('u1',);
        expect(invalidateUserCacheMock,).toHaveBeenCalledWith('u1',);

        const audit = logAuditMock.mock.calls[0]![0] as Record<string, unknown>;
        expect(audit.action,).toBe('delete',);
        expect(audit.entityType,).toBe('user',);
        expect(audit.entityId,).toBe('u1',);
        expect(audit.oldValues,).toMatchObject({ email: 'gone@example.com', role: 'member', },);
    },);
},);
