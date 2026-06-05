/**
 * API keys for headless clients.
 *
 * Format: `ssk_<43 chars base64url>` (256 bits of entropy). The
 * plaintext is returned exactly once at creation; only sha256(key)
 * is stored. Verification hashes the presented token and looks up
 * the active row; `last_used_at` is updated fire-and-forget.
 *
 * Scopes are coarse and hierarchical: read < write < admin.
 */
import crypto from 'crypto';
import type { ApiKeyScope, } from '@rw/shared';
import * as repo from '../repositories/apiKeys.repo';
import { logAudit, } from './audit';
import { logger, } from '../utils/logger';
import { uuidOrNull, } from '../utils/uuid';
import type { AuditContext, } from './types';

export type { ApiKeyRow, } from '../repositories/apiKeys.repo';

export const KEY_PREFIX = 'ssk_';

const SCOPE_RANK: Record<ApiKeyScope, number> = { read: 0, write: 1, admin: 2, };

/** Does any granted scope satisfy the required one? (read < write < admin) */
export function scopeSatisfies(granted: ApiKeyScope[], required: ApiKeyScope,): boolean {
    return granted.some((s,) => SCOPE_RANK[s] >= SCOPE_RANK[required],);
}

/** Minimum scope an HTTP method needs on a protected route. */
export function requiredScopeFor(method: string,): ApiKeyScope {
    return method === 'GET' || method === 'HEAD' ? 'read' : 'write';
}

export function hashKey(plaintext: string,): string {
    return crypto.createHash('sha256',).update(plaintext,).digest('hex',);
}

export async function create(
    input: { name: string; scopes: ApiKeyScope[]; },
    ctx: AuditContext,
): Promise<{ apiKey: repo.ApiKeyRow; plaintextKey: string; }> {
    const plaintextKey = KEY_PREFIX + crypto.randomBytes(32,).toString('base64url',);
    const apiKey = await repo.insertKey({
        name: input.name,
        keyHash: hashKey(plaintextKey,),
        keyPrefix: plaintextKey.slice(0, 12,),
        scopes: input.scopes,
        // created_by is a UUID FK; synthetic actors (api-key:<name>, system)
        // become NULL.
        createdBy: uuidOrNull(ctx.userId,),
    },);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'api-key',
        entityId: apiKey.id,
        newValues: { name: input.name, scopes: input.scopes, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { apiKey, plaintextKey, };
}

export async function list(): Promise<repo.ApiKeyRow[]> {
    return repo.listKeys();
}

export async function revoke(id: string, ctx: AuditContext,): Promise<repo.ApiKeyRow | null> {
    const revoked = await repo.revokeKey(id,);
    if (revoked) {
        await logAudit({
            userId: ctx.userId,
            action: 'revoke',
            entityType: 'api-key',
            entityId: id,
            newValues: { name: revoked.name, },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }
    return revoked;
}

/** Verify a presented token. Returns the active key row or null.
 *  Updates last_used_at without blocking the request. */
export async function verify(plaintext: string,): Promise<repo.ApiKeyRow | null> {
    if (!plaintext.startsWith(KEY_PREFIX,)) return null;
    const key = await repo.findActiveByHash(hashKey(plaintext,),);
    if (!key) return null;
    void repo.touchLastUsed(key.id,).catch((err,) =>
        logger.warn('api-key last_used update failed', { id: key.id, err, },)
    );
    return key;
}
