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
import type { ContentBlockTemplate, ContentBlockTemplateBlock, } from '@sitesurge/types';
import { getPool, query, } from '../db';
import * as blockStyleResolution from '../services/blockStyleResolution';

// ── Template metadata ──

interface TemplateRow {
    id: string;
    name: string;
    description: string | null;
    entity_type_key: string | null;
    mode: 'single' | 'list';
    max_records: number | null;
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
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
    if (row.description) out.description = row.description;
    return out;
}

export async function listByType(entityTypeKey: string,): Promise<ContentBlockTemplate[]> {
    const r = await query<TemplateRow>(
        `SELECT * FROM content_block_templates WHERE entity_type_key = $1 ORDER BY created_at DESC`,
        [entityTypeKey,],
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
    entityTypeKey?: string | null;
    mode?: 'single' | 'list';
    maxRecords?: number | null;
}

export async function create(input: CreateInput,): Promise<ContentBlockTemplate> {
    const r = await query<TemplateRow>(`
        INSERT INTO content_block_templates (name, description, entity_type_key, mode, max_records)
        VALUES ($1, $2, $3, COALESCE($4, 'single'), $5)
        RETURNING *
    `, [
        input.name,
        input.description ?? null,
        input.entityTypeKey ?? null,
        input.mode ?? null,
        input.maxRecords ?? null,
    ],);
    return mapTemplate(r.rows[0],);
}

export async function update(id: string, patch: Partial<CreateInput>,): Promise<ContentBlockTemplate | null> {
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
    if (fields.length === 0) return findById(id,);
    values.push(id,);
    const r = await query<TemplateRow>(
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
         ORDER BY parent_block_id NULLS FIRST, position`,
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

/**
 * Replace the entire block tree for a template in a single transaction so a
 * failed save can't leave half the new blocks and half the old ones.
 */
export async function replaceBlocks(templateId: string, blocks: SaveBlockInput[],): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(`DELETE FROM content_block_template_blocks WHERE template_id = $1`, [templateId,],);
        for (const b of blocks) {
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
        await client.query('COMMIT',);
    } catch (err) {
        await client.query('ROLLBACK',);
        throw err;
    } finally {
        client.release();
    }
}
