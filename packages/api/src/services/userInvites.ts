/**
 * Account invites — "create an account and get these roles" (e.g. brand
 * ambassadors). Admin: Users → Invite. Guide: docs/how-it-works/ROLES-AND-INVITES.md.
 *
 *   invite(email, roles)  existing account → the roles are ADDED to it now
 *                         (+ `user_role_added` email); otherwise an invite row
 *                         with a random token (only its SHA-256 stored), valid
 *                         3 days, and the `user_invite` email with /invite/<token>.
 *   accept(token, …)      creates the account through the normal member sign-up
 *                         (handle, contact, notifications), email marked
 *                         VERIFIED when it is the invited address, the roles added.
 * Roles land in `users.extra_roles`, so a later membership never removes them.
 */
import { createHash, randomBytes, } from 'crypto';
import type { UserInvite, UserInviteBody, UserInviteResult, UserInvitePublic, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { config, } from '../config';
import { ConflictError, NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logAudit, } from './audit';
import { sendPurposeMail, } from './mail/purposes';
import { assertRoleExists, } from './subscriptionTiers';
import type { AuditContext, } from './types';
import { addExtraRoles, } from './users';

const TTL_DAYS = 3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const hash = (token: string,) => createHash('sha256',).update(token,).digest('hex',);
const site = () => ((config.frontendUrl as string | undefined) ?? '').replace(/\/+$/, '',);
const longDate = (d: Date,) => d.toLocaleDateString('en-US', { dateStyle: 'long', },);

async function roleLabels(keys: string[],): Promise<string> {
    if (!keys.length) return '';
    const r = await query<{ key: string; label: string; }>(`SELECT key, label FROM roles WHERE key = ANY($1)`, [keys,],);
    const by = new Map(r.rows.map((x,) => [x.key, x.label,]),);
    return keys.map((k,) => by.get(k,) ?? k,).join(', ',);
}

async function validRoles(roles: string[],): Promise<string[]> {
    const list = [...new Set(roles.map((r,) => r.trim(),).filter(Boolean,),),];
    if (!list.length) throw new ValidationError('Choose at least one role.',);
    for (const r of list) {
        if (isStaffRole(r,) || r === 'anonymous') throw new ValidationError(`An invite cannot give the "${r}" role.`,);
        await assertRoleExists(r,);
    }
    return list;
}

function mapInvite(r: Record<string, unknown>,): UserInvite {
    const expires = new Date(r.expires_at as string,);
    const status: UserInvite['status'] = r.revoked_at ? 'revoked' : r.accepted_at ? 'accepted' : expires < new Date() ? 'expired' : 'pending';
    return {
        id: String(r.id,), email: String(r.email,), name: (r.name as string | null) ?? null, roles: (r.roles as string[]) ?? [],
        status, expiresAt: expires.toISOString(), createdAt: new Date(r.created_at as string,).toISOString(),
        acceptedAt: r.accepted_at ? new Date(r.accepted_at as string,).toISOString() : null,
        acceptedUserId: (r.accepted_user_id as string | null) ?? null, invitedBy: (r.invited_by as string | null) ?? null,
    };
}

/** Invite someone (or give an existing account the roles now). */
export async function invite(body: UserInviteBody, ctx: AuditContext,): Promise<UserInviteResult> {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email,)) throw new ValidationError('Enter a valid email address.',);
    const roles = await validRoles(body.roles,);
    const labels = await roleLabels(roles,);

    const existing = await query<{ id: string; display_name: string | null; }>(`SELECT id, display_name FROM users WHERE lower(email) = $1`, [email,],);
    if (existing.rows[0]) {
        const u = existing.rows[0];
        await addExtraRoles(u.id, roles,);
        void sendPurposeMail('user_role_added', {
            to: email,
            context: { user: { name: u.display_name ?? '', email, }, roles: labels, login_url: `${site()}/login`, },
        },);
        await logAudit({ userId: ctx.userId, action: 'add_roles', entityType: 'user', entityId: u.id, newValues: { roles, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
        return { result: 'roles_added', userId: u.id, invite: null, };
    }

    // One live invite per address: an older pending one is replaced.
    await query(`UPDATE user_invites SET revoked_at = NOW() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL`, [email,],);
    const token = randomBytes(32,).toString('base64url',);
    const expires = new Date(Date.now() + TTL_DAYS * 86400_000,);
    const r = await query(
        `INSERT INTO user_invites (email, name, roles, token_hash, expires_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [email, body.name?.trim() || null, roles, hash(token,), expires, ctx.userId || null,],
    );
    await sendInviteEmail(email, body.name?.trim() || '', token, labels, expires,);
    await logAudit({ userId: ctx.userId, action: 'invite', entityType: 'user_invite', entityId: String(r.rows[0].id,), newValues: { email, roles, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return { result: 'invited', userId: null, invite: mapInvite(r.rows[0],), };
}

async function sendInviteEmail(email: string, name: string, token: string, roles: string, expires: Date,): Promise<void> {
    const url = `${site()}/invite/${token}`;
    const ok = await sendPurposeMail('user_invite', {
        to: email,
        context: { user: { name, email, }, invite_url: url, inviteUrl: url, roles, expires_at: longDate(expires,), },
    },);
    if (!ok) throw new ValidationError('The invite email could not be sent — check Users → Settings → Email templates (Account invite) and the mail settings.',);
}

export async function list(): Promise<UserInvite[]> {
    const r = await query(
        `SELECT i.*, u.display_name AS invited_by FROM user_invites i LEFT JOIN users u ON u.id = i.created_by
          ORDER BY i.created_at DESC LIMIT 200`,
    );
    return r.rows.map(mapInvite,);
}

export async function revoke(id: string, ctx: AuditContext,): Promise<void> {
    const r = await query(`UPDATE user_invites SET revoked_at = NOW() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [id,],);
    if (!r.rowCount) throw new NotFoundError('Invite',);
    await logAudit({ userId: ctx.userId, action: 'revoke', entityType: 'user_invite', entityId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
}

/** Send a fresh link (a new token + 3 more days); the old link stops working. */
export async function resend(id: string, ctx: AuditContext,): Promise<UserInvite> {
    const cur = await query(`SELECT * FROM user_invites WHERE id = $1 AND accepted_at IS NULL`, [id,],);
    const row = cur.rows[0];
    if (!row) throw new NotFoundError('Invite',);
    const token = randomBytes(32,).toString('base64url',);
    const expires = new Date(Date.now() + TTL_DAYS * 86400_000,);
    const r = await query(`UPDATE user_invites SET token_hash = $2, expires_at = $3, revoked_at = NULL WHERE id = $1 RETURNING *`, [id, hash(token,), expires,],);
    await sendInviteEmail(row.email, row.name ?? '', token, await roleLabels(row.roles,), expires,);
    await logAudit({ userId: ctx.userId, action: 'resend', entityType: 'user_invite', entityId: id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, },);
    return mapInvite(r.rows[0],);
}

async function liveInvite(token: string,) {
    const r = await query(`SELECT * FROM user_invites WHERE token_hash = $1`, [hash(token,),],);
    const row = r.rows[0];
    if (!row || row.revoked_at) throw new NotFoundError('Invite',);
    if (row.accepted_at) throw new ConflictError('This invite was already used — sign in instead.',);
    if (new Date(row.expires_at,) < new Date()) throw new ValidationError('This invite has expired. Ask for a new one.',);
    return row;
}

/** GET /auth/invites/:token — what the account form shows. */
export async function publicView(token: string,): Promise<UserInvitePublic> {
    const row = await liveInvite(token,);
    return { email: row.email, name: row.name ?? '', roles: await roleLabels(row.roles,), expiresAt: new Date(row.expires_at,).toISOString(), };
}

/**
 * POST /auth/invites/:token/accept — create the account. The caller signs it
 * in. The invited address is trusted (the link proved it); a different address
 * goes through normal email verification.
 */
export async function accept(
    token: string,
    input: { name: string; email: string; password: string; },
    ctx: { ipAddress?: string; userAgent?: string; },
): Promise<{ userId: string; email: string; role: string; }> {
    const row = await liveInvite(token,);
    const email = input.email.trim().toLowerCase();
    const { registerMember, } = await import('./auth.js');
    const res = await registerMember(
        { name: input.name, email, password: input.password, },
        ctx,
        { verified: email === String(row.email,).toLowerCase(), extraRoles: row.roles, },
    );
    await query(`UPDATE user_invites SET accepted_at = NOW(), accepted_user_id = $2 WHERE id = $1`, [row.id, res.userId,],);
    return { userId: res.userId, email: res.email, role: 'member', };
}
