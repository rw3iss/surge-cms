/**
 * Block storage for mail templates. Mirrors the `blocks` table shape so
 * the same frontend BlockEditor + BlockRenderer code can work against
 * it. Save is a transactional replace: delete all blocks for the
 * template, insert the new flat list. Simplifies the editor by
 * avoiding per-block diffing.
 */
import { query, getPool, } from '../db';

export interface MailTemplateBlockRow {
    id: string;
    templateId: string;
    parentBlockId: string | null;
    blockType: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

interface DbRow {
    id: string;
    template_id: string;
    parent_block_id: string | null;
    block_type: string;
    position: number;
    settings: Record<string, unknown>;
    style: Record<string, unknown>;
}

function map(row: DbRow,): MailTemplateBlockRow {
    return {
        id: row.id,
        templateId: row.template_id,
        parentBlockId: row.parent_block_id,
        blockType: row.block_type,
        position: row.position,
        settings: row.settings ?? {},
        style: row.style ?? {},
    };
}

export async function findByTemplate(templateId: string,): Promise<MailTemplateBlockRow[]> {
    const r = await query<DbRow>(
        `SELECT * FROM mail_template_blocks
         WHERE template_id = $1
         ORDER BY parent_block_id NULLS FIRST, position`,
        [templateId,],
    );
    return r.rows.map(map,);
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
 * Replace the entire block tree for a template. Done in a single
 * transaction so a failed save can't leave the template with half
 * the new blocks and half the old ones.
 */
export async function replaceAll(
    templateId: string,
    blocks: SaveBlockInput[],
): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(`DELETE FROM mail_template_blocks WHERE template_id = $1`, [templateId,],);
        for (const b of blocks) {
            await client.query(
                `INSERT INTO mail_template_blocks
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
