import { createHash, } from 'crypto';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
vi.mock('../config', () => ({ config: { frontendUrl: 'https://site.test', jwt: { secret: 's', }, }, }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
const mail = vi.fn(async () => true,);
vi.mock('./mail/purposes', () => ({ sendPurposeMail: (...a: unknown[]) => mail(...a), }),);
vi.mock('./subscriptionTiers', () => ({ assertRoleExists: vi.fn(async () => undefined,), }),);
const addExtra = vi.fn(async () => [],);
vi.mock('./users', () => ({ addExtraRoles: (...a: unknown[]) => addExtra(...a), }),);
const register = vi.fn(async () => ({ userId: 'new-user', email: 'amb@x.co', verificationRequired: false, }),);
vi.mock('./auth.js', () => ({ registerMember: (...a: unknown[]) => register(...a), }),);

import { accept, invite, } from './userInvites';

const ctx = { userId: 'admin', } as never;
function db(map: Array<[string, unknown[]]>,) {
    q.mockImplementation(async (sql: string,) => {
        const hit = map.find(([f,],) => sql.includes(f,));
        return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0, };
    },);
}
beforeEach(() => [q, mail, addExtra, register,].forEach((f,) => f.mockClear(),),);

describe('invite', () => {
    it('adds the roles to an existing account instead of inviting it', async () => {
        db([['FROM roles', [{ key: 'ambassador', label: 'Ambassador', },],], ['FROM users WHERE lower(email)', [{ id: 'u1', display_name: 'Ann', },],],],);
        const res = await invite({ email: 'Ann@X.co', roles: ['ambassador',], }, ctx,);
        expect(res.result,).toBe('roles_added',);
        expect(addExtra,).toHaveBeenCalledWith('u1', ['ambassador',],);
        expect(mail.mock.calls[0][0],).toBe('user_role_added',);
    },);

    it('emails a 3-day link for a new address and stores only the token hash', async () => {
        const now = Date.now();
        db([['FROM roles', [{ key: 'ambassador', label: 'Ambassador', },],], ['INSERT INTO user_invites', [{ id: 'i1', email: 'amb@x.co', roles: ['ambassador',], expires_at: new Date(now + 3 * 86400_000,), created_at: new Date(), },],],],);
        const res = await invite({ email: 'amb@x.co', roles: ['ambassador',], }, ctx,);
        expect(res.result,).toBe('invited',);
        const [, input,] = mail.mock.calls[0] as [string, { context: { invite_url: string; }; }];
        const token = input.context.invite_url.split('/invite/',)[1];
        const insert = q.mock.calls.find(([s,],) => String(s,).includes('INSERT INTO user_invites',),)!;
        expect(insert[1][3],).toBe(createHash('sha256',).update(token,).digest('hex',),);
        expect(JSON.stringify(insert[1],),).not.toContain(token,);
        const expires = insert[1][4] as Date;
        expect(Math.round((expires.getTime() - now) / 86400_000,),).toBe(3,);
    },);

    it('refuses a staff role', async () => {
        await expect(invite({ email: 'a@x.co', roles: ['admin',], }, ctx,),).rejects.toThrow(/cannot give/,);
    },);
},);

describe('accept', () => {
    const row = (extra: object,) => ({ id: 'i1', email: 'amb@x.co', roles: ['ambassador',], expires_at: new Date(Date.now() + 86400_000,), accepted_at: null, revoked_at: null, ...extra, });

    it('creates the account with the roles; the invited address counts as verified', async () => {
        db([['FROM user_invites WHERE token_hash', [row({},),],],],);
        await accept('t'.repeat(30,), { name: 'Amb', email: 'AMB@x.co', password: 'password1', }, {},);
        expect(register.mock.calls[0][2],).toEqual({ verified: true, extraRoles: ['ambassador',], },);
        expect(q.mock.calls.some(([s,],) => String(s,).includes('SET accepted_at = NOW()',),),).toBe(true,);
    },);

    it('a different address is not pre-verified', async () => {
        db([['FROM user_invites WHERE token_hash', [row({},),],],],);
        await accept('t'.repeat(30,), { name: 'Amb', email: 'other@x.co', password: 'password1', }, {},);
        expect((register.mock.calls[0][2] as { verified: boolean; }).verified,).toBe(false,);
    },);

    it('refuses an expired or used link', async () => {
        db([['FROM user_invites WHERE token_hash', [row({ expires_at: new Date(Date.now() - 1000,), },),],],],);
        await expect(accept('t'.repeat(30,), { name: 'a', email: 'amb@x.co', password: 'password1', }, {},),).rejects.toThrow(/expired/,);
        db([['FROM user_invites WHERE token_hash', [row({ accepted_at: new Date(), },),],],],);
        await expect(accept('t'.repeat(30,), { name: 'a', email: 'amb@x.co', password: 'password1', }, {},),).rejects.toThrow(/already used/,);
        expect(register,).not.toHaveBeenCalled();
    },);
},);
