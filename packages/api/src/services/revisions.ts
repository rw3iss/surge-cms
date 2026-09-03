/**
 * Content revisions — full-tree snapshots of a page or post.
 *
 * ## Why this exists in its own module
 *
 * Revisions used to be a two-line side effect inside `pages.update()`: snapshot
 * the page ROW, then update. That is why a deleted block could not be restored
 * — the block tree was never in the snapshot, so "restore" only ever put the
 * title and status back and left the content exactly as the mistake left it.
 *
 * A snapshot here is the whole thing: the entity row AND every block, with all
 * their columns (settings, style, parent_block_id, order, visibility). Restoring
 * one reproduces the content byte for byte, nesting included.
 *
 * ## When a snapshot is taken
 *
 * On SAVE, and only on save. Editor drafts live in the browser's localStorage
 * and never reach the server, so every server-side write already IS a save —
 * but one save is many HTTP calls (a page update plus a create/update/delete per
 * block). Snapshotting on each of those would produce twenty near-identical
 * revisions per save and, worse, each would capture a half-written page.
 *
 * So writes do not snapshot directly. They call `markDirty()`, which starts a
 * short quiet-period timer; the snapshot is taken once the writes stop, of the
 * settled result. `flush()` takes it immediately — the editor calls that when
 * its save finishes, so the revision is in the list before the panel reloads.
 *
 * A consequence worth knowing: this also covers writes from the SDK, the MCP
 * server and plugins. Anything that edits content gets history, without each
 * caller having to remember to ask for it.
 *
 * ## Storage
 *
 * A snapshot is JSONB. Postgres TOAST-compresses any value over ~2 kB, so a
 * 26-block page (roughly 60-150 kB of JSON) is stored at a few tens of kB.
 * Retention is by age — `revisions.historyDays`, default 10 — with a floor of
 * `MIN_KEEP` newest revisions that survive regardless, so an entity edited once
 * and then left alone for a year still has its history.
 */
import { query, transaction, } from '../db';
import { camelToSnake, mapRow, mapRows, } from '../utils/mapRow';
import { logger, } from '../utils/logger';
import { createHash, } from 'crypto';
import type { PoolClient, } from 'pg';
import type { RevisionEntityType, } from '@sitesurge/types';
import { uuidOrNull, } from '../utils/uuid';

/** Current snapshot shape. 1 = legacy (entity row only, no blocks). */
export const SNAPSHOT_VERSION = 2;

/** Newest revisions that are never pruned, however old they are. Without this,
 *  an entity nobody has touched for a month would silently lose all history. */
const MIN_KEEP = 5;

/** Hard per-entity ceiling, so a script writing in a loop can't grow the table
 *  without bound inside the retention window. */
const MAX_KEEP = 200;

/** Default retention when the setting is unset. */
export const DEFAULT_HISTORY_DAYS = 10;

/** Quiet period after the last write before the settled state is snapshotted. */
const SETTLE_MS = 4000;

/**
 * Where each entity's blocks live.
 *
 * The two tables do NOT share a shape, which is easy to miss: `blocks` orders by
 * `"order"` and nests via `parent_block_id`; `post_content_blocks` orders by
 * `sort_order` and has no nesting at all. Assuming the pages shape for both
 * makes every post snapshot fail on an unknown column.
 */
const BLOCK_TABLE: Record<
    RevisionEntityType,
    { table: string; fk: string; orderCol: string; parentCol: string | null; }
> = {
    page: { table: 'blocks', fk: 'page_id', orderCol: '"order"', parentCol: 'parent_block_id', },
    post: { table: 'post_content_blocks', fk: 'post_id', orderCol: 'sort_order', parentCol: null, },
};

const ENTITY_TABLE: Record<RevisionEntityType, string> = {
    page: 'pages',
    post: 'posts',
};

export interface ContentSnapshot {
    v: number;
    entity: Record<string, unknown>;
    blocks: Array<Record<string, unknown>>;
}

// ─── Retention setting ────────────────────────────────────────────

let historyDaysCache: { value: number; at: number; } | null = null;
const SETTING_TTL_MS = 60_000;

/** Days of history to keep. Read from the `revisions` keyed setting, cached
 *  briefly — the sweep runs on every save and must not add a query each time. */
export async function historyDays(): Promise<number> {
    const now = Date.now();
    if (historyDaysCache && now - historyDaysCache.at < SETTING_TTL_MS) {
        return historyDaysCache.value;
    }
    let days = DEFAULT_HISTORY_DAYS;
    try {
        const r = await query(`SELECT value FROM site_settings WHERE key = 'revisions'`,);
        const v = r.rows[0]?.value as { historyDays?: unknown; } | undefined;
        const n = v && typeof v === 'object' ? Number(v.historyDays,) : NaN;
        // 0 is meaningful ("age-based pruning off"), so only reject NaN/negative.
        if (Number.isFinite(n,) && n >= 0) days = n;
    } catch {
        // A missing settings row must not stop content from being saved.
    }
    historyDaysCache = { value: days, at: now, };
    return days;
}

export function invalidateRevisionSettings(): void {
    historyDaysCache = null;
}

// ─── Snapshot capture ─────────────────────────────────────────────

/**
 * Fields that change on every write without changing the content. Excluded
 * from the hash so re-saving an unmodified page doesn't look like an edit.
 */
const VOLATILE_FIELDS = new Set(['updatedAt', 'updated_at', 'viewCount', 'view_count',],);

/** Stable JSON for hashing: object keys sorted, volatile fields dropped. */
function canonical(value: unknown,): unknown {
    if (Array.isArray(value,)) return value.map(canonical,);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(src,).sort()) {
            if (VOLATILE_FIELDS.has(k,)) continue;
            out[k] = canonical(src[k],);
        }
        return out;
    }
    if (value instanceof Date) return value.toISOString();
    return value;
}

export function hashSnapshot(snap: ContentSnapshot,): string {
    // Blocks are sorted by id so a different SELECT order can't look like a change.
    const blocks = [...snap.blocks,].sort((a, b,) => String(a.id,).localeCompare(String(b.id,),));
    return createHash('sha256',)
        .update(JSON.stringify(canonical({ entity: snap.entity, blocks, },),),)
        .digest('hex',);
}

/** Read the entity row and its complete block list as they are right now. */
async function captureSnapshot(
    entityType: RevisionEntityType,
    entityId: string,
): Promise<ContentSnapshot | null> {
    const entityRes = await query(
        `SELECT * FROM ${ENTITY_TABLE[entityType]} WHERE id = $1`,
        [entityId,],
    );
    if (entityRes.rows.length === 0) return null;

    const { table, fk, orderCol, parentCol, } = BLOCK_TABLE[entityType];
    // Raw rows, every column — including any added by a later migration. The
    // restore matches columns by name, so a snapshot stays restorable across
    // schema changes in both directions.
    const order = parentCol
        ? `${parentCol} NULLS FIRST, ${orderCol} ASC`
        : `${orderCol} ASC`;
    const blockRes = await query(
        `SELECT * FROM ${table} WHERE ${fk} = $1 ORDER BY ${order}`,
        [entityId,],
    );

    return {
        v: SNAPSHOT_VERSION,
        entity: mapRow<Record<string, unknown>>(entityRes.rows[0],),
        blocks: mapRows<Record<string, unknown>>(blockRes.rows,),
    };
}

/**
 * Write a snapshot of the entity's current state.
 *
 * Returns the new version, or null when nothing was written — either the entity
 * is gone or its content is identical to the newest revision (a save that
 * changed nothing, or a second server instance that already recorded this one).
 */
export async function snapshot(
    entityType: RevisionEntityType,
    entityId: string,
    authorId: string | null,
    summary?: string,
): Promise<number | null> {
    const snap = await captureSnapshot(entityType, entityId,);
    if (!snap) return null;

    const hash = hashSnapshot(snap,);

    const latest = await query(
        `SELECT content_hash FROM revisions
         WHERE entity_type = $1 AND entity_id = $2
         ORDER BY version DESC LIMIT 1`,
        [entityType, entityId,],
    );
    if (latest.rows[0]?.content_hash === hash) return null;

    const versionRes = await query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM revisions
         WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, entityId,],
    );
    const version = Number(versionRes.rows[0].next,);

    await query(
        `INSERT INTO revisions
             (entity_type, entity_id, version, snapshot, snapshot_version,
              content_hash, author_id, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (entity_type, entity_id, version) DO NOTHING`,
        [
            entityType, entityId, version, JSON.stringify(snap,), SNAPSHOT_VERSION,
            hash, uuidOrNull(authorId,), summary ?? null,
        ],
    );

    await prune(entityType, entityId,);
    return version;
}

// ─── Retention ────────────────────────────────────────────────────

/**
 * Drop revisions past the retention window.
 *
 * Two guards keep this from erasing a history nobody asked to erase: the newest
 * `MIN_KEEP` are always kept whatever their age, and `historyDays` of 0 turns
 * age-based pruning off entirely (leaving only the `MAX_KEEP` ceiling).
 */
export async function prune(entityType: RevisionEntityType, entityId: string,): Promise<void> {
    const days = await historyDays();

    if (days > 0) {
        await query(
            `DELETE FROM revisions
             WHERE entity_type = $1 AND entity_id = $2
               AND created_at < NOW() - ($3 || ' days')::INTERVAL
               AND version NOT IN (
                   SELECT version FROM revisions
                   WHERE entity_type = $1 AND entity_id = $2
                   ORDER BY version DESC LIMIT $4
               )`,
            [entityType, entityId, String(days,), MIN_KEEP,],
        );
    }

    await query(
        `DELETE FROM revisions
         WHERE entity_type = $1 AND entity_id = $2
           AND version NOT IN (
               SELECT version FROM revisions
               WHERE entity_type = $1 AND entity_id = $2
               ORDER BY version DESC LIMIT $3
           )`,
        [entityType, entityId, MAX_KEEP,],
    );
}

// ─── Settle-then-snapshot ─────────────────────────────────────────

interface Pending {
    timer: NodeJS.Timeout;
    authorId: string | null;
}

const pending = new Map<string, Pending>();
const keyOf = (t: RevisionEntityType, id: string,) => `${t}:${id}`;

/**
 * Note that an entity was written, and snapshot it once the writes stop.
 *
 * Called by every content mutation. The timer restarts on each call, so the
 * twenty-odd requests of a single editor save collapse into one revision of the
 * finished result rather than twenty of a page mid-write.
 *
 * Never throws and never blocks the caller: history is worth having, but not at
 * the cost of failing the save it is recording.
 */
export function markDirty(
    entityType: RevisionEntityType,
    entityId: string,
    authorId: string | null,
): void {
    if (!entityId) return;
    const key = keyOf(entityType, entityId,);
    const existing = pending.get(key,);
    if (existing) clearTimeout(existing.timer,);

    const timer = setTimeout(() => {
        pending.delete(key,);
        void snapshot(entityType, entityId, authorId,).catch((err,) => {
            logger.warn(`Revision snapshot failed for ${key}: ${(err as Error).message}`,);
        },);
    }, SETTLE_MS,);
    // Don't hold the process open for a pending snapshot on shutdown.
    timer.unref?.();

    pending.set(key, { timer, authorId, },);
}

/**
 * Take the pending snapshot now instead of waiting out the quiet period.
 *
 * The editor calls this the moment its save completes, so the new revision is
 * already in the list when the panel refreshes. Safe to call with nothing
 * pending — it just snapshots the current state.
 */
export async function flush(
    entityType: RevisionEntityType,
    entityId: string,
    authorId: string | null,
    summary?: string,
): Promise<number | null> {
    const key = keyOf(entityType, entityId,);
    const existing = pending.get(key,);
    if (existing) {
        clearTimeout(existing.timer,);
        pending.delete(key,);
    }
    return snapshot(entityType, entityId, authorId ?? existing?.authorId ?? null, summary,);
}

/** Drop a queued snapshot without taking it. Used by `restore`, which is about
 *  to write its own snapshot of the same state and does not want two. */
export function cancelPending(entityType: RevisionEntityType, entityId: string,): void {
    const key = keyOf(entityType, entityId,);
    const existing = pending.get(key,);
    if (existing) {
        clearTimeout(existing.timer,);
        pending.delete(key,);
    }
}

/** Write out everything still waiting. Called on shutdown so an edit made
 *  seconds before a deploy isn't lost from the history. */
export async function flushAll(): Promise<void> {
    const entries = [...pending.entries(),];
    pending.clear();
    for (const [key, p,] of entries) {
        clearTimeout(p.timer,);
        const [type, id,] = key.split(':',) as [RevisionEntityType, string,];
        try {
            await snapshot(type, id, p.authorId,);
        } catch {
            /* shutting down; nothing useful to do with the error */
        }
    }
}

// ─── Read ─────────────────────────────────────────────────────────

export async function list(entityType: RevisionEntityType, entityId: string, limit = 50,) {
    const result = await query(
        `SELECT r.id, r.entity_type, r.entity_id, r.version, r.author_id, r.summary,
                r.created_at, r.snapshot_version,
                u.display_name AS author_name,
                -- Type-checked rather than COALESCEd: a legacy snapshot can hold
                -- a JSON null (not a SQL NULL) at 'blocks', and jsonb_array_length
                -- errors on a scalar, which would break the whole list.
                CASE WHEN jsonb_typeof(r.snapshot -> 'blocks') = 'array'
                     THEN jsonb_array_length(r.snapshot -> 'blocks') ELSE 0 END AS block_count
         FROM revisions r
         LEFT JOIN users u ON r.author_id = u.id
         WHERE r.entity_type = $1 AND r.entity_id = $2
         ORDER BY r.version DESC
         LIMIT $3`,
        [entityType, entityId, limit,],
    );
    return mapRows<Record<string, unknown>>(result.rows,);
}

export async function get(entityType: RevisionEntityType, entityId: string, version: number,) {
    const result = await query(
        `SELECT r.*, u.display_name AS author_name
         FROM revisions r
         LEFT JOIN users u ON r.author_id = u.id
         WHERE r.entity_type = $1 AND r.entity_id = $2 AND r.version = $3`,
        [entityType, entityId, version,],
    );
    return result.rows.length ? mapRow<Record<string, unknown>>(result.rows[0],) : null;
}

// ─── Restore ──────────────────────────────────────────────────────

/** Columns a restore must never overwrite: identity, ownership and counters
 *  that belong to the live row rather than to any past version of it. */
const ENTITY_SKIP = new Set([
    'id', 'created_at', 'created_by', 'author_id', 'search_vector', 'view_count',
    // Set explicitly by the UPDATE below. Assigning it from the snapshot too
    // makes Postgres reject the whole statement ("multiple assignments to same
    // column"), which took out every restore.
    'updated_at',
],);

/** Live column names for a table, so a snapshot is written back by name and
 *  columns that have since been added or dropped are simply skipped. */
async function columnsOf(client: PoolClient, table: string,): Promise<Set<string>> {
    const r = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [table,],
    );
    return new Set(r.rows.map((row,) => row.column_name as string),);
}

/**
 * Order blocks so every parent is inserted before its children.
 *
 * `parent_block_id` is a self-referencing FK, so a child inserted first fails.
 * Sorting by `parent_block_id NULLS FIRST` is NOT enough — it puts all roots
 * first, but below that it orders by a UUID, so a grandchild can precede its
 * child-of-root parent. Groups nest arbitrarily deep, so this walks the tree.
 *
 * Blocks whose parent is missing from the snapshot are appended at the end with
 * their parent link dropped: better a visible orphan at the bottom of the page
 * than a restore that aborts on a foreign key.
 */
export function orderParentsFirst(
    blocks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    const byParent = new Map<string | null, Array<Record<string, unknown>>>();
    const ids = new Set(blocks.map((b,) => String(b.id,)),);

    for (const block of blocks) {
        const raw = block.parentBlockId ?? block.parent_block_id ?? null;
        // Treat a dangling parent as a root so the block still lands.
        const parent = raw != null && ids.has(String(raw,),) ? String(raw,) : null;
        const b = parent === null && raw != null
            ? { ...block, parentBlockId: null, parent_block_id: null, }
            : block;
        const list = byParent.get(parent,) ?? [];
        list.push(b,);
        byParent.set(parent, list,);
    }

    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const walk = (parent: string | null,) => {
        for (const b of byParent.get(parent,) ?? []) {
            const id = String(b.id,);
            if (seen.has(id,)) continue;   // a cycle would otherwise recurse forever
            seen.add(id,);
            out.push(b,);
            walk(id,);
        }
    };
    walk(null,);

    // Anything left is part of a parent cycle; emit it de-parented rather than
    // dropping content the operator expected to get back.
    for (const b of blocks) {
        if (!seen.has(String(b.id,),)) {
            out.push({ ...b, parentBlockId: null, parent_block_id: null, },);
        }
    }
    return out;
}

export interface RestoreResult {
    version: number;
    /** Blocks written back. Zero for a legacy snapshot that has none. */
    blocksRestored: number;
    /** True when the snapshot predates full-tree capture, so only the entity's
     *  fields were restored and the content was left as it is. */
    metadataOnly: boolean;
    /** Version of the safety snapshot taken before the restore, if one was. */
    undoVersion: number | null;
}

/**
 * Restore a revision, in one transaction.
 *
 * The current state is snapshotted first, so a restore can itself be undone —
 * important, because restoring is exactly the sort of thing done in a hurry
 * after a mistake, and picking the wrong version should not compound it.
 *
 * Blocks are re-inserted with their ORIGINAL ids. That matters: `parent_block_id`
 * references them, so fresh ids would flatten every nested group into a heap of
 * orphans. Deleting and re-inserting inside the transaction, rather than diffing,
 * keeps the result exact — including blocks that were added since and must go.
 */
export async function restore(
    entityType: RevisionEntityType,
    entityId: string,
    version: number,
    authorId: string | null,
): Promise<RestoreResult> {
    // Drop rather than flush any queued snapshot: the safety copy taken below
    // captures the same state, and letting both run would record it twice.
    cancelPending(entityType, entityId,);

    const rev = await get(entityType, entityId, version,);
    if (!rev) throw new Error(`Revision v${version} not found`,);

    const snap = rev.snapshot as ContentSnapshot | Record<string, unknown>;
    const isFullTree = Number(rev.snapshotVersion ?? 1,) >= 2 && Array.isArray((snap as ContentSnapshot).blocks,);

    const entityData = (isFullTree ? (snap as ContentSnapshot).entity : snap) as Record<string, unknown>;
    const blocks = isFullTree ? (snap as ContentSnapshot).blocks : [];

    const undoVersion = await snapshot(
        entityType, entityId, authorId, `Before restoring v${version}`,
    );

    const entityTable = ENTITY_TABLE[entityType];
    const { table: blockTable, fk, } = BLOCK_TABLE[entityType];

    const blocksRestored = await transaction(async (client,) => {
        // Entity row.
        const entityCols = await columnsOf(client, entityTable,);
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [k, v,] of Object.entries(entityData,)) {
            const col = camelToSnake(k,);
            if (!entityCols.has(col,) || ENTITY_SKIP.has(col,)) continue;
            values.push(v,);
            sets.push(`"${col}" = $${values.length}`,);
        }
        if (sets.length) {
            values.push(entityId,);
            await client.query(
                `UPDATE ${entityTable} SET ${sets.join(', ',)}, updated_at = NOW()
                 WHERE id = $${values.length}`,
                values,
            );
        }

        if (!isFullTree) return 0;

        // Blocks: clear, then rewrite exactly.
        await client.query(`DELETE FROM ${blockTable} WHERE ${fk} = $1`, [entityId,],);

        const blockCols = await columnsOf(client, blockTable,);
        for (const b of orderParentsFirst(blocks,)) {
            const cols: string[] = [];
            const vals: unknown[] = [];
            for (const [k, v,] of Object.entries(b,)) {
                const col = camelToSnake(k,);
                if (!blockCols.has(col,)) continue;
                cols.push(`"${col}"`,);
                vals.push(v,);
            }
            if (!cols.length) continue;
            const placeholders = vals.map((_, i,) => `$${i + 1}`,).join(', ',);
            await client.query(
                `INSERT INTO ${blockTable} (${cols.join(', ',)}) VALUES (${placeholders})`,
                vals,
            );
        }
        return blocks.length;
    },);

    return {
        version,
        blocksRestored,
        metadataOnly: !isFullTree,
        undoVersion,
    };
}
