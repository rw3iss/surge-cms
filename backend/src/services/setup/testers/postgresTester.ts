import { Pool, } from 'pg';
import type { ConnectionTester, TestResult, } from './ConnectionTester';

export interface PostgresTesterInput {
    /** Either a connection URL or component fields. URL wins. */
    url?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    timeoutMs?: number;
}

/**
 * Classified probe result. The wizard renders different copy for each
 * `kind` so the user knows whether to fix their entry, toggle on
 * "create role/db if missing", or check that Postgres is even running.
 *
 * Distinguishing role-missing vs auth-failed isn't always possible —
 * vanilla Postgres returns the same `28P01` for both. We disambiguate
 * by retrying against the `postgres` system DB:
 *   - Stage 1 fails with 28P01 → user might be missing OR password wrong
 *   - Stage 2 (same creds, system DB) succeeds → DB doesn't exist (3D000 path didn't trigger; rare)
 *   - Stage 2 fails with 28P01 → role missing OR wrong password (still ambiguous; show generic auth)
 */
export type PostgresProbeKind =
    | 'unreachable'
    | 'auth-failed'
    | 'database-missing'
    | 'role-missing'
    | 'timeout'
    | 'unknown';

export interface PostgresTesterDetail {
    serverVersion: string;
    /** True when stage 2 (system DB) probe succeeded, proving server + creds are fine
     * even though the target DB connection failed. */
    serverReachable?: boolean;
}

export interface PostgresTesterFailure {
    ok: false;
    kind: PostgresProbeKind;
    error: string;
    code?: string;
    /** True when the server itself was reachable (i.e. the failure is
     * specific to the database/role, not the network). */
    serverReachable: boolean;
}

function buildUrl(input: PostgresTesterInput,): string {
    if (input.url) return input.url;
    const { host = 'localhost', port = 5432, database = 'postgres', user = 'postgres', password = '', } = input;
    const auth = password ? `${encodeURIComponent(user,)}:${encodeURIComponent(password,)}` : encodeURIComponent(user,);
    return `postgresql://${auth}@${host}:${port}/${encodeURIComponent(database,)}`;
}

async function probeOnce(url: string, timeoutMs: number,): Promise<{
    ok: true;
    serverVersion: string;
} | {
    ok: false;
    error: string;
    code?: string;
}> {
    const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: timeoutMs, },);
    try {
        const result = await Promise.race([
            pool.query<{ version: string; }>('SELECT version() as version',),
            new Promise<never>((_, reject,) =>
                setTimeout(() => reject(Object.assign(new Error('Connection timed out',), { code: 'ETIMEDOUT', },),), timeoutMs,)
            ),
        ],);
        return { ok: true, serverVersion: result.rows[0]?.version ?? 'unknown', };
    } catch (error) {
        const err = error as NodeJS.ErrnoException & { code?: string; };
        return { ok: false, error: err.message, code: err.code, };
    } finally {
        await pool.end().catch(() => {/* ignore */});
    }
}

function classify(code: string | undefined, message: string,): PostgresProbeKind {
    // Network-level errors first.
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
        return 'unreachable';
    }
    if (code === 'ETIMEDOUT') return 'timeout';

    // Postgres SQLSTATE codes.
    if (code === '3D000') return 'database-missing'; // invalid_catalog_name
    if (code === '28P01' || code === '28000') {
        // 28P01 = invalid_password; 28000 = invalid_authorization_specification.
        // Postgres wraps both "wrong password" and "role does not exist" in 28P01,
        // but the message text differs. We use the text as a hint.
        if (/role .* does not exist/i.test(message,)) return 'role-missing';
        return 'auth-failed';
    }
    return 'unknown';
}

export class PostgresTester implements ConnectionTester<PostgresTesterInput, PostgresTesterDetail> {
    async test(input: PostgresTesterInput,): Promise<TestResult<PostgresTesterDetail> | PostgresTesterFailure> {
        const timeoutMs = input.timeoutMs ?? 3_000;

        // Stage 1: hit the target DB with the given creds.
        const stage1Url = buildUrl(input,);
        const r1 = await probeOnce(stage1Url, timeoutMs,);
        if (r1.ok) {
            return { ok: true, detail: { serverVersion: r1.serverVersion, serverReachable: true, }, };
        }

        const kind = classify(r1.code, r1.error,);
        if (kind === 'unreachable' || kind === 'timeout') {
            return { ok: false, kind, error: r1.error, code: r1.code, serverReachable: false, };
        }

        // Stage 2: same creds, but against the `postgres` system DB. This
        // separates "wrong DB" from "wrong creds". We only do this when the
        // first probe pointed at a custom DB.
        const targetDb = (input.database ?? '').toLowerCase();
        let serverReachable = false;
        if (targetDb && targetDb !== 'postgres') {
            const stage2Url = buildUrl({ ...input, database: 'postgres', },);
            const r2 = await probeOnce(stage2Url, timeoutMs,);
            if (r2.ok) {
                // Server up, creds work, target DB just doesn't exist.
                return {
                    ok: false,
                    kind: 'database-missing',
                    error: `Database "${input.database}" does not exist`,
                    code: '3D000',
                    serverReachable: true,
                };
            }
            // If stage 2 also fails, propagate stage 2's classification (more accurate)
            const k2 = classify(r2.code, r2.error,);
            if (k2 === 'unreachable' || k2 === 'timeout') {
                return { ok: false, kind: k2, error: r2.error, code: r2.code, serverReachable: false, };
            }
            serverReachable = false;
            // Auth-failed against postgres DB too → creds bad or role missing
            return { ok: false, kind: k2, error: r2.error, code: r2.code, serverReachable, };
        }

        return { ok: false, kind, error: r1.error, code: r1.code, serverReachable, };
    }
}

export const postgresTester = new PostgresTester();
export { buildUrl as buildPostgresUrl, };
