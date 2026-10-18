/**
 * Data access for `content_block_templates` (metadata) + their block subtree in
 * `content_block_template_blocks`. Modeled directly on the mail-template pair
 * (`mailTemplates.repo` + `mailTemplateBlocks.repo`): standard CRUD for the
 * template row, plus a transactional block replace.
 *
 * Block-style template refs (`style = { id: <uuid> }` pointing at a row in
 * `block_styles`) are resolved on read via `populateBlockStyles` so the
 * renderer ingests fully-inlined style props.
 */
import { randomUUID, } from 'crypto';
import { orderParentsFirst, } from '../services/revisions';
import type { ContentBlockTemplate, ContentBlockTemplateBlock, TemplateListRender, TemplateSlot, } from '@sitesurge/types';
import type { PoolClient, } from 'pg';
import { getPool, query, } from '../db';

/** A query runner: the pool's `query`, or a transaction's client. */
type Runner = Pick<PoolClient, 'query'>;
const pooled: Runner = { query: ((sql: string, params?: unknown[],) => query(sql, params as never,)) as never, };
import * as blockStyleResolution from '../services/blockStyleResolution';

// ── Template metadata ──

interface TemplateRow {
    id: string;
    name: string;
    description: string | null;
    entity_type_key: string | null;
    mode: 'single' | 'list';
    max_records: number | null;
    list_render: TemplateListRender | null;
    sample_record_ids: string[] | null;
    script: string | null;
    script_enabled: boolean;
    slots: TemplateSlot[] | null;
    created_at: Date;
    updated_at: Date;
}

function mapTemplate(row: TemplateRow,): ContentBlockTemplate {
    const out: ContentBlockTemplate = {
        id: row.id,
        name: row.name,
        entityTypeKey: row.entity_type_key,
        mode: row.mode,
        maxRecords: row.max_records,
        listRender: row.list_render === 'once' ? 'once' : 'each',
        sampleRecordIds: row.sample_record_ids ?? [],
        slots: Array.isArray(row.slots,) ? row.slots : [],
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
    if (row.description) out.description = row.description;
    if (row.script != null) out.script = row.script;
    out.scriptEnabled = row.script_enabled !== false;
    return out;
}

export async function listByType(entityTypeKey: string,): Promise<ContentBlockTemplate[]> {
    const r = await query<TemplateRow>(
        `SELECT * FROM content_block_templates WHERE entity_type_key = $1 ORDER BY created_at DESC`,
        [entityTypeKey,],
    );
    return r.rows.map(mapTemplate,);
}

/**
 * Templates with NO entity type — reusable "components" bound to nothing.
 *
 * `entity_type_key` was already nullable, so a global template needs no
 * migration; only the `/entities/:type/templates` routes forced a value, by
 * injecting it from the URL. `IS NULL` (not `= NULL`) because SQL comparisons
 * against NULL are never true.
 */
export async function listGlobal(): Promise<ContentBlockTemplate[]> {
    const r = await query<TemplateRow>(
        `SELECT * FROM content_block_templates WHERE entity_type_key IS NULL ORDER BY created_at DESC`,
    );
    return r.rows.map(mapTemplate,);
}

export async function findById(id: string,): Promise<ContentBlockTemplate | null> {
    const r = await query<TemplateRow>(`SELECT * FROM content_block_templates WHERE id = $1`, [id,],);
    return r.rows[0] ? mapTemplate(r.rows[0],) : null;
}

export interface CreateInput {
    name: string;
    description?: string;
    script?: string | null;
    scriptEnabled?: boolean;
    entityTypeKey?: string | null;
    mode?: 'single' | 'list';
    maxRecords?: number | null;
    listRender?: TemplateListRender;
    sampleRecordIds?: string[] | null;
    /** Already validated by the service (`normalizeTemplateSlots`). */
    slots?: TemplateSlot[];
}

export async function create(input: CreateInput, db: Runner = pooled,): Promise<ContentBlockTemplate> {
    const r = await db.query<TemplateRow>(`
        INSERT INTO content_block_templates
            (name, description, entity_type_key, mode, max_records, sample_record_ids, script, script_enabled, slots, list_render)
        VALUES ($1, $2, $3, COALESCE($4, 'single'), $5, $6::text[], $7, COALESCE($8, true), $9::jsonb, COALESCE($10, 'each'))
        RETURNING *
    `, [
        input.name,
        input.description ?? null,
        input.entityTypeKey ?? null,
        input.mode ?? null,
        input.maxRecords ?? null,
        input.sampleRecordIds ?? null,
        input.script ?? null,
        input.scriptEnabled ?? null,
        JSON.stringify(input.slots ?? [],),
        input.listRender ?? null,
    ],);
    return mapTemplate(r.rows[0],);
}

export async function update(id: string, patch: Partial<CreateInput>, db: Runner = pooled,): Promise<ContentBlockTemplate | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, val: unknown,): void => {
        values.push(val,);
        fields.push(`${col} = $${values.length}`,);
    };
    if (patch.name !== undefined) set('name', patch.name,);
    if (patch.description !== undefined) set('description', patch.description ?? null,);
    if (patch.entityTypeKey !== undefined) set('entity_type_key', patch.entityTypeKey ?? null,);
    if (patch.mode !== undefined) set('mode', patch.mode,);
    if (patch.maxRecords !== undefined) set('max_records', patch.maxRecords ?? null,);
    if (patch.listRender !== undefined) set('list_render', patch.listRender === 'once' ? 'once' : 'each',);
    if (patch.sampleRecordIds !== undefined) {
        // Explicit ::text[] cast so pg types the array param in this dynamic SET.
        values.push(patch.sampleRecordIds ?? null,);
        fields.push(`sample_record_ids = $${values.length}::text[]`,);
    }
    if (patch.slots !== undefined) {
        values.push(JSON.stringify(patch.slots ?? [],),);
        fields.push(`slots = $${values.length}::jsonb`,);
    }
    if (patch.script !== undefined) set('script', patch.script ?? null,);
    if (patch.scriptEnabled !== undefined) set('script_enabled', patch.scriptEnabled,);
    if (fields.length === 0) {
        const cur = await db.query<TemplateRow>(`SELECT * FROM content_block_templates WHERE id = $1`, [id,],);
        return cur.rows[0] ? mapTemplate(cur.rows[0],) : null;
    }
    values.push(id,);
    const r = await db.query<TemplateRow>(
        `UPDATE content_block_templates SET ${fields.join(', ',)} WHERE id = $${values.length} RETURNING *`,
        values,
    );
    return r.rows[0] ? mapTemplate(r.rows[0],) : null;
}

export async function remove(id: string,): Promise<void> {
    await query(`DELETE FROM content_block_templates WHERE id = $1`, [id,],);
}

// ── Block subtree ──

interface BlockRow {
    id: string;
    template_id: string;
    parent_block_id: string | null;
    block_type: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

function mapBlock(row: BlockRow,): ContentBlockTemplateBlock {
    return {
        id: row.id,
        templateId: row.template_id,
        parentBlockId: row.parent_block_id,
        blockType: row.block_type as ContentBlockTemplateBlock['blockType'],
        position: row.position,
        settings: row.settings ?? {},
        style: row.style ?? {},
    };
}

/**
 * Raw block list (unresolved styles). The editor reads `style.id` and turns it
 * into a styleRef so the picker shows the correct template.
 */
export async function findBlocks(templateId: string,): Promise<ContentBlockTemplateBlock[]> {
    const r = await query<BlockRow>(
        `SELECT * FROM content_block_template_blocks
         WHERE template_id = $1
         ORDER BY parent_block_id NULLS FIRST, position, id ASC`,
        [templateId,],
    );
    return r.rows.map(mapBlock,);
}

/**
 * Same as `findBlocks` but resolves any `style.id` template refs to their
 * inlined property bags via `block_styles` (shared resolver — pages, posts,
 * mail templates + content-block templates can't drift on the contract).
 */
export async function findBlocksResolved(templateId: string,): Promise<ContentBlockTemplateBlock[]> {
    const blocks = await findBlocks(templateId,);
    return blockStyleResolution.populateBlockStyles(blocks,);
}

export interface SaveBlockInput {
    id?: string;
    parentBlockId?: string | null;
    blockType: string;
    position: number;
    settings?: Record<string, unknown>;
    style?: Record<string, unknown>;
}

/** Insert a template's whole block tree on `client` (inside the caller's transaction). */
async function writeBlocks(client: Runner, templateId: string, blocks: SaveBlockInput[],): Promise<void> {
    await client.query(`DELETE FROM content_block_template_blocks WHERE template_id = $1`, [templateId,],);
    // `parent_block_id` is a non-deferrable self-FK, so a child sent before
    // its parent failed the WHOLE save. Insert parents first (the same walk
    // revisions use); id-less blocks get an id here so the walk can key them.
    const ordered = orderParentsFirst(
        blocks.map((b,) => ({ ...b, id: b.id ?? randomUUID(), }) as unknown as Record<string, unknown>),
    ) as unknown as SaveBlockInput[];
    for (const b of ordered) {
        await client.query(
            `INSERT INTO content_block_template_blocks
                (id, template_id, parent_block_id, block_type, position, settings, style)
             VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4::block_type, $5, $6::jsonb, $7::jsonb)`,
            [
                b.id ?? null,
                templateId,
                b.parentBlockId ?? null,
                b.blockType,
                b.position,
                JSON.stringify(b.settings ?? {},),
                JSON.stringify(b.style ?? {},),
            ],
        );
    }
}

/** Run `fn` in one transaction. */
async function inTransaction<T,>(fn: (client: PoolClient,) => Promise<T>,): Promise<T> {
    const client = await getPool().connect();
    try {
        await client.query('BEGIN',);
        const out = await fn(client,);
        await client.query('COMMIT',);
        return out;
    } catch (err) {
        await client.query('ROLLBACK',);
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Replace the entire block tree for a template in a single transaction so a
 * failed save can't leave half the new blocks and half the old ones.
 */
export async function replaceBlocks(templateId: string, blocks: SaveBlockInput[],): Promise<void> {
    await inTransaction((client,) => writeBlocks(client, templateId, blocks,),);
}

/**
 * Create a template WITH its blocks, or update one's metadata AND blocks, in
 * ONE transaction. Two requests (meta, then blocks) could leave new slots /
 * listRender beside the old blocks — rendered everywhere the template is used —
 * when the second failed; a failed create left an empty template behind.
 */
export async function saveWithBlocks(
    id: string | null,
    input: Partial<CreateInput>,
    blocks: SaveBlockInput[],
): Promise<ContentBlockTemplate | null> {
    return inTransaction(async (client,) => {
        const tpl = id ? await update(id, input, client,) : await create(input as CreateInput, client,);
        if (!tpl) return null;
        await writeBlocks(client, tpl.id, blocks,);
        return tpl;
    },);
}
