import { beforeEach, describe, expect, it, vi, } from 'vitest';
import bcrypt from 'bcryptjs';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), transaction: vi.fn(), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./audienceIntake', () => ({ captureAudience: vi.fn(), }),);
vi.mock('./notifications', () => ({ buildNotification: vi.fn(), notifyUser: vi.fn(), notifyWith: vi.fn(), personLabel: vi.fn(), }),);
const settings = { requireEmailVerification: true, requireSubscription: false, };
vi.mock('./settings', () => ({ getUsersSettings: vi.fn(async () => settings,), }),);
const resend = vi.fn(async () => true,);
vi.mock('./mail/verification', () => ({ generateVerificationToken: () => 't', sendVerificationEmail: vi.fn(), resendVerification: (...a: unknown[]) => resend(...a), }),);

import { authenticateWithEmail, EMAIL_NOT_VERIFIED, NETWORK_BANNED_MESSAGE, resendVerificationByEmail, } from './auth';

const hash = bcrypt.hashSync('right-password', 4,);
const userRow = (extra: object = {},) => ({ id: 'u1', email: 'a@b.co', password_hash: hash, role: 'member', is_active: true, is_banned: false, email_verified: true, ...extra, });
function db(o: { ipBan?: boolean; emailBan?: boolean; user?: object | null; },) {
    q.mockImplementation(async (sql: string,) => {
        if (sql.includes('ip_address = $1',)) return { rows: o.ipBan ? [{},] : [], };
        if (sql.includes('lower(email) = lower($1) AND (expires_at',)) return { rows: o.emailBan ? [{},] : [], };
        if (sql.includes('FROM users WHERE email = $1',)) return { rows: o.user ? [o.user,] : [], };
        return { rows: [], };
    },);
}
beforeEach(() => { q.mockReset(); resend.mockClear(); },);

describe('authenticateWithEmail — ban checks', () => {
    it('a banned network gets a neutral message (says nothing about the email)', async () => {
        db({ ipBan: true, user: userRow(), },);
        await expect(authenticateWithEmail('a@b.co', 'x', '9.9.9.9',),).rejects.toThrow(NETWORK_BANNED_MESSAGE,);
    },);

    it('a banned email is only revealed after the right password', async () => {
        db({ emailBan: true, user: userRow(), },);
        await expect(authenticateWithEmail('a@b.co', 'wrong',),).rejects.toThrow(/Invalid email or password/,);
        await expect(authenticateWithEmail('a@b.co', 'right-password',),).rejects.toThrow(/banned/,);
    },);
},);

describe('authenticateWithEmail — verification gate', () => {
    it('applies to custom member-based roles too, with a typed code', async () => {
        db({ user: userRow({ role: 'subscriber', email_verified: false, },), },);
        await expect(authenticateWithEmail('a@b.co', 'right-password',),).rejects.toMatchObject({ code: EMAIL_NOT_VERIFIED, },);
    },);
},);

describe('resendVerificationByEmail', () => {
    it('sends only for an unverified account and never throws', async () => {
        q.mockResolvedValueOnce({ rows: [{ id: 'u1', },], },);
        await resendVerificationByEmail('a@b.co',);
        expect(resend,).toHaveBeenCalledWith('u1',);
        q.mockResolvedValueOnce({ rows: [], },);
        await resendVerificationByEmail('nobody@b.co',);
        expect(resend,).toHaveBeenCalledTimes(1,);
        q.mockRejectedValueOnce(new Error('db down',),);
        await expect(resendVerificationByEmail('a@b.co',),).resolves.toBeUndefined();
    },);
},);
