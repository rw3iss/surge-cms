import { describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
const tx = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), transaction: (...a: unknown[]) => tx(...a), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
const invalidateLoginRoutes = vi.fn();
vi.mock('./loginRoute', () => ({ invalidateLoginRoutes: () => invalidateLoginRoutes(), }),);
vi.mock('./permissions', () => ({ ENTITLED_STATUSES: ['active',], invalidatePermissionCache: vi.fn(), invalidatePlan: vi.fn(), invalidateRoles: vi.fn(), }),);

const { deleteRole, saveTier, } = await import('./subscriptionTiers');

const role = { key: 'scout', label: 'Scout', base_role: 'member', is_system: false, sort_order: 50, user_count: 0, };

describe('deleteRole', () => {
    it('refuses while a pending invite would grant the role', async () => {
        q.mockReset().mockImplementation(async (sql: string,) => {
            if (sql.includes('FROM roles r',)) return { rows: [role,], };
            if (sql.includes('FROM user_invites',)) return { rows: [{ n: 2, },], };
            return { rows: [], };
        },);
        tx.mockReset();
        await expect(deleteRole('scout', { userId: 'admin', } as never,),).rejects.toThrow(/2 pending invite/,);
        expect(tx,).not.toHaveBeenCalled();
    },);

    it('deletes and refreshes the sign-in routes', async () => {
        q.mockReset().mockImplementation(async (sql: string,) => {
            if (sql.includes('FROM roles r',)) return { rows: [role,], };
            if (sql.includes('FROM user_invites',)) return { rows: [{ n: 0, },], };
            return { rows: [], };
        },);
        tx.mockReset().mockResolvedValue(undefined,);
        invalidateLoginRoutes.mockReset();
        await deleteRole('scout', { userId: 'admin', } as never,);
        expect(tx,).toHaveBeenCalledOnce();
        expect(invalidateLoginRoutes,).toHaveBeenCalled();
    },);
},);

describe('saveTier — switching "Add its role only"', () => {
    function run(counts: { subs: number; apps: number; }, current: boolean, roleOnly: boolean,) {
        const client = {
            query: vi.fn(async (sql: string,) => {
                if (sql.includes('SELECT is_free',)) return { rows: [{ is_free: false, role_only: current, },], };
                if (sql.includes('AS subs',)) return { rows: [counts,], };
                return { rows: [], };
            },),
        };
        q.mockReset().mockResolvedValue({ rows: [], },);
        tx.mockReset().mockImplementation(async (fn: (c: unknown,) => unknown,) => fn(client,),);
        return { client, promise: saveTier('t1', { roleOnly, }, { userId: 'admin', } as never,), };
    }

    it('refuses to turn a level with members into a program', async () => {
        await expect(run({ subs: 3, apps: 0, }, false, true,).promise,).rejects.toThrow(/3 member\(s\)/,);
    },);

    it('refuses either way while applications are open', async () => {
        await expect(run({ subs: 0, apps: 1, }, true, false,).promise,).rejects.toThrow(/1 application\(s\)/,);
    },);

    it('does not check when the value is unchanged', async () => {
        const { client, promise, } = run({ subs: 9, apps: 9, }, true, true,);
        await promise.catch(() => undefined,);
        expect(client.query.mock.calls.some(([sql,],) => String(sql,).includes('AS subs',),),).toBe(false,);
    },);
},);
