/**
 * Runtime table generator for the generic entity system. Builds the DDL for a
 * custom entity type's backing table (and ALTERs for schema extensions), then
 * applies it under a per-type advisory lock, ledgered in `entity_migrations`
 * (hash-guarded → idempotent). Modeled on `features/migrations.ts`'s
 * `pg_advisory_xact_lock(hashtext($1))` pattern.
 *
 * The DDL builders are pure + unit-tested (`tableGenerator.test.ts`); the
 * `ensure*` functions take a PoolClient that MUST already be inside a
 * transaction (the advisory lock is transaction-scoped).
 */
import { createHash, } from 'crypto';
import type { PoolClient, } from 'pg';
import type { EntityFieldDef, EntityTypeDef, } from '@sitesurge/types';
import { isColumnField, } from '@sitesurge/types';
import { assertSafeIdentifier, mapFieldColumnDdl, standardColumnsDdl, } from './columnMap';

/** A minimal client surface — a real PoolClient or a test fake. */
export interface DdlClient {
    query(sql: string, params?: unknown[],): Promise<{ rows: unknown[]; }>;
}

// ─── Pure DDL builders ───────────────────────────────────────────────

/** `CREATE TABLE IF NOT EXISTS <table> ( … )` for a type's full schema. */
export function buildCreateTableDdl(typeDef: EntityTypeDef,): string {
    const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
    const cols = [
        ...standardColumnsDdl(typeDef,),
        ...typeDef.fields.map(mapFieldColumnDdl,).filter((c,): c is string => c !== null),
    ];
    return `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${cols.join(',\n  ',)}\n)`;
}

/** `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> …` for one field. */
export function buildAddColumnDdl(tableName: string, field: EntityFieldDef,): string | null {
    const ddl = mapFieldColumnDdl(field,);
    if (!ddl) return null;
    const table = assertSafeIdentifier(tableName, 'table name',);
    return `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${ddl}`;
}

/** `ALTER TABLE <table> DROP COLUMN IF EXISTS <col>`. */
export function buildDropColumnDdl(tableName: string, fieldKey: string,): string {
    const table = assertSafeIdentifier(tableName, 'table name',);
    const col = assertSafeIdentifier(fieldKey, 'field key',);
    return `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}"`;
}

/** Index DDLs: unique slug + per-field indexes (indexed / unique flags). */
export function buildIndexDdls(typeDef: EntityTypeDef,): string[] {
    const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
    const out: string[] = [];
    if (typeDef.hasSlug) {
        out.push(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_slug_uniq" ON "${table}" ("slug")`,);
    }
    if (typeDef.hasStatus) {
        out.push(`CREATE INDEX IF NOT EXISTS "${table}_status_idx" ON "${table}" ("status")`,);
    }
    for (const f of typeDef.fields) {
        if (!isColumnField(f.type,) || !f.indexed || f.unique) continue;
        const col = assertSafeIdentifier(f.key, 'field key',);
        out.push(`CREATE INDEX IF NOT EXISTS "${table}_${col}_idx" ON "${table}" ("${col}")`,);
    }
    if (typeDef.searchable) {
        out.push(`CREATE INDEX IF NOT EXISTS "${table}_search_idx" ON "${table}" USING GIN ("search_vector")`,);
    }
    return out;
}

/** Trigger DDLs: shared updated_at + (when searchable) a search_vector builder
 *  over the type's searchable text fields. Returns [] when nothing applies. */
export function buildTriggerDdls(typeDef: EntityTypeDef,): string[] {
    const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
    const out = [
        `DROP TRIGGER IF EXISTS "trg_${table}_updated_at" ON "${table}"`,
        `CREATE TRIGGER "trg_${table}_updated_at" BEFORE UPDATE ON "${table}" `
        + `FOR EACH ROW EXECUTE FUNCTION update_updated_at()`,
    ];
    const searchCols = typeDef.searchable
        ? typeDef.fields.filter((f,) =>
            f.searchable && ['text', 'longtext', 'richtext', 'markdown', 'slug',].includes(f.type,)
        )
        : [];
    if (searchCols.length > 0) {
        const expr = searchCols
            .map((f,) => `coalesce(NEW."${assertSafeIdentifier(f.key, 'field key',)}", '')`)
            .join(" || ' ' || ",);
        out.push(
            `CREATE OR REPLACE FUNCTION "${table}_search_vector"() RETURNS trigger AS $$\n`
            + `BEGIN\n  NEW.search_vector := to_tsvector('english', ${expr});\n  RETURN NEW;\nEND;\n`
            + `$$ LANGUAGE plpgsql`,
        );
        out.push(`DROP TRIGGER IF EXISTS "trg_${table}_search" ON "${table}"`,);
        out.push(
            `CREATE TRIGGER "trg_${table}_search" BEFORE INSERT OR UPDATE ON "${table}" `
            + `FOR EACH ROW EXECUTE FUNCTION "${table}_search_vector"()`,
        );
    }
    return out;
}

// ─── Ledgered apply (idempotent, advisory-locked) ────────────────────

function hashStatement(s: string,): string {
    return createHash('sha256',).update(s,).digest('hex',);
}

/** Apply one DDL statement once per type: skip if its hash is already in the
 *  ledger, else run + record. Returns true when it actually ran. */
export async function applyLedgered(client: DdlClient, key: string, statement: string,): Promise<boolean> {
    const h = hashStatement(statement,);
    const existing = await client.query(
        'SELECT 1 FROM entity_migrations WHERE entity_type_key = $1 AND statement_hash = $2',
        [key, h,],
    );
    if (existing.rows.length > 0) return false;
    await client.query(statement,);
    await client.query(
        `INSERT INTO entity_migrations (entity_type_key, statement_hash, statement)
         VALUES ($1, $2, $3) ON CONFLICT (entity_type_key, statement_hash) DO NOTHING`,
        [key, h, statement,],
    );
    return true;
}

/** Take the per-type advisory lock (transaction-scoped). */
async function lock(client: DdlClient, key: string,): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`entity:${key}`,],);
}

/**
 * Create (if missing) a custom type's table + indexes + triggers. Idempotent.
 * Returns the DDL statements that actually ran. MUST be called inside a
 * transaction. Not for adopted core tables (those already exist).
 */
export async function ensureTable(typeDef: EntityTypeDef, client: PoolClient | DdlClient,): Promise<string[]> {
    await lock(client, typeDef.key,);
    const applied: string[] = [];
    const statements = [
        buildCreateTableDdl(typeDef,),
        ...buildIndexDdls(typeDef,),
        ...buildTriggerDdls(typeDef,),
    ];
    for (const s of statements) {
        if (await applyLedgered(client, typeDef.key, s,)) applied.push(s,);
    }
    return applied;
}

/** Add one column to an existing table (schema extension). Idempotent. */
export async function ensureColumn(
    typeDef: Pick<EntityTypeDef, 'key' | 'tableName'>,
    field: EntityFieldDef,
    client: PoolClient | DdlClient,
): Promise<boolean> {
    const ddl = buildAddColumnDdl(typeDef.tableName, field,);
    if (!ddl) return false;
    await lock(client, typeDef.key,);
    let ran = await applyLedgered(client, typeDef.key, ddl,);
    if (field.indexed && !field.unique) {
        const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
        const col = assertSafeIdentifier(field.key, 'field key',);
        ran = await applyLedgered(
            client,
            typeDef.key,
            `CREATE INDEX IF NOT EXISTS "${table}_${col}_idx" ON "${table}" ("${col}")`,
        ) || ran;
    }
    return ran;
}

/** Drop one column (non-core only — the service enforces the core guard). */
export async function dropColumn(
    typeDef: Pick<EntityTypeDef, 'key' | 'tableName'>,
    fieldKey: string,
    client: PoolClient | DdlClient,
): Promise<void> {
    await lock(client, typeDef.key,);
    await client.query(buildDropColumnDdl(typeDef.tableName, fieldKey,),);
}

/** Drop a custom type's whole table (uninstall). CASCADE removes dependents. */
export async function dropTable(
    typeDef: Pick<EntityTypeDef, 'key' | 'tableName'>,
    client: PoolClient | DdlClient,
): Promise<void> {
    await lock(client, typeDef.key,);
    const table = assertSafeIdentifier(typeDef.tableName, 'table name',);
    await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`,);
    await client.query('DELETE FROM entity_migrations WHERE entity_type_key = $1', [typeDef.key,],);
}
