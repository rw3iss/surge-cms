/**
 * api_keys data access. Plaintext keys never reach this layer —
 * callers pass the sha256 hash.
 */
import type { ApiKeyScope, } from '@rw/cms-shared';
import { query, } from '../db';
import { mapRow, } from '../utils/mapRow';

export interface ApiKeyRow {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdBy: string | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

const COLS = 'id, name, key_prefix, scopes, created_by, last_used_at, revoked_at, created_at';

export async function insertKey(input: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdBy: string | null;
},): Promise<ApiKeyRow> {
    const result = await query(
        `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLS}`,
        [input.name, input.keyHash, input.keyPrefix, input.scopes, input.createdBy,],
    );
    return mapRow<ApiKeyRow>(result.rows[0] as Record<string, unknown>,);
}

export async function listKeys(): Promise<ApiKeyRow[]> {
    const result = await query(
        `SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`,
    );
    return (result.rows as Record<string, unknown>[]).map((r,) => mapRow<ApiKeyRow>(r,),);
}

export async function findActiveByHash(keyHash: string,): Promise<ApiKeyRow | null> {
    const result = await query(
        `SELECT ${COLS} FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
        [keyHash,],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow<ApiKeyRow>(row,) : null;
}

export async function revokeKey(id: string,): Promise<ApiKeyRow | null> {
    const result = await query(
        `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL
         RETURNING ${COLS}`,
        [id,],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow<ApiKeyRow>(row,) : null;
}

export async function touchLastUsed(id: string,): Promise<void> {
    await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [id,],);
}
