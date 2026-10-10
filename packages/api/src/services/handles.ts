/**
 * Member handles — the URL-safe name of a public member page
 * (`/members/:handle`). Unique case-insensitively (index `users_handle_lower`,
 * migration 132). Derived from the display name at sign-up, editable in the
 * profile. Every user-creation path calls `assignHandle`; a user created
 * without one (e.g. between deploys) gets one lazily via `ensureHandle`.
 */
import type { PoolClient, } from 'pg';
import { ConflictError, ValidationError, } from '../core/errors';
import { query, } from '../db';

export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,39}$/;

/** Words a handle may not be (they would read as site routes or roles). */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
    'admin', 'api', 'me', 'new', 'edit', 'settings', 'members', 'anonymous', 'staff', 'system',
],);

/** Slug a display name (or email local part) into a handle base. Pure. */
export function slugifyHandle(source: string | null | undefined,): string {
    let s = String(source ?? '',)
        .normalize('NFKD',)
        .replace(/[\u0300-\u036f]/g, '',)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-',)
        .replace(/-{2,}/g, '-',)
        .replace(/^[-_]+|[-_]+$/g, '',)
        .slice(0, 30,)
        .replace(/[-_]+$/g, '',);
    if (!s) s = 'member';
    if (s.length < 3 || RESERVED_HANDLES.has(s,)) s = `${s}-member`;
    return s;
}

/** Validate a handle typed by a member. Returns it normalised (lower-case). Pure. */
export function normalizeHandle(input: string,): string {
    const h = String(input ?? '',).trim().toLowerCase();
    if (!HANDLE_RE.test(h,)) {
        throw new ValidationError('A handle is 3–40 characters: letters, digits, "-" or "_", starting with a letter or digit.',);
    }
    if (RESERVED_HANDLES.has(h,)) throw new ValidationError(`"${h}" is reserved — please choose another handle.`,);
    return h;
}

/** First free candidate: `base`, then `base-1`, `base-2`, … Pure given `taken`. */
export function pickFreeHandle(base: string, taken: ReadonlySet<string>,): string {
    if (!taken.has(base,)) return base;
    for (let n = 1; n < 10_000; n++) {
        const suffix = `-${n}`;
        const candidate = `${base.slice(0, 40 - suffix.length,)}${suffix}`;
        if (!taken.has(candidate,)) return candidate;
    }
    return `${base.slice(0, 31,)}-${Date.now().toString(36,)}`;
}

type Runner = Pick<PoolClient, 'query'>;
const db = (client?: Runner,): Runner => client ?? { query: query as never, };

/** Handles already in use that start with `base` (lower-case). */
async function takenLike(base: string, client?: Runner, exceptUserId?: string,): Promise<Set<string>> {
    const r = await db(client,).query(
        `SELECT lower(handle) AS h FROM users WHERE lower(handle) LIKE $1 ${exceptUserId ? 'AND id <> $2' : ''}`,
        exceptUserId ? [`${base.replace(/[%_\\]/g, '\\$&',)}%`, exceptUserId,] : [`${base.replace(/[%_\\]/g, '\\$&',)}%`,],
    );
    return new Set((r.rows as { h: string; }[]).map((x,) => x.h),);
}

/**
 * Give a user a handle derived from `source` (display name / email) unless
 * they already have one. Safe to call after any INSERT/UPSERT; retries on the
 * rare race where two sign-ups claim the same candidate.
 */
export async function assignHandle(userId: string, source: string | null | undefined, client?: Runner,): Promise<string> {
    const cur = await db(client,).query(`SELECT handle, display_name, email FROM users WHERE id = $1`, [userId,],);
    const row = cur.rows[0] as { handle: string | null; display_name: string | null; email: string | null; } | undefined;
    if (!row) throw new ValidationError('User not found',);
    if (row.handle) return row.handle;
    const base = slugifyHandle(source || row.display_name || (row.email ?? '').split('@',)[0],);
    for (let attempt = 0; attempt < 5; attempt++) {
        const handle = pickFreeHandle(base, await takenLike(base, client,),);
        try {
            const r = await db(client,).query(
                `UPDATE users SET handle = $2 WHERE id = $1 AND handle IS NULL RETURNING handle`, [userId, handle,],
            );
            const set = (r.rows[0] as { handle?: string; } | undefined)?.handle;
            if (set) return set;
            // Someone set it in between — read it back.
            const again = await db(client,).query(`SELECT handle FROM users WHERE id = $1`, [userId,],);
            return (again.rows[0] as { handle: string; }).handle;
        } catch (e) {
            if ((e as { code?: string; }).code !== '23505') throw e; // unique violation → next candidate
        }
    }
    throw new ConflictError('Could not assign a member handle — please try again.',);
}

/** The user's handle, assigning one first when missing. */
export async function ensureHandle(userId: string,): Promise<string> {
    return assignHandle(userId, null,);
}

/** Change a member's own handle (validated; 409 when taken). */
export async function setHandle(userId: string, input: string,): Promise<string> {
    const h = normalizeHandle(input,);
    const clash = await query(`SELECT 1 FROM users WHERE lower(handle) = $1 AND id <> $2 LIMIT 1`, [h, userId,],);
    if (clash.rows.length) throw new ConflictError(`The handle "${h}" is already taken — please choose another.`,);
    try {
        await query(`UPDATE users SET handle = $2, updated_at = NOW() WHERE id = $1`, [userId, h,],);
    } catch (e) {
        if ((e as { code?: string; }).code === '23505') throw new ConflictError(`The handle "${h}" is already taken — please choose another.`,);
        throw e;
    }
    return h;
}
