import type { BlockStyle, } from '@sitesurge/types';
import { query, } from '../db';
import { NotFoundError, } from '../middleware/error';
import { mapRow, mapRows, } from '../utils/mapRow';

export async function findAll(): Promise<BlockStyle[]> {
    const result = await query(
        'SELECT * FROM block_styles ORDER BY is_default DESC, name ASC',
    );
    return mapRows<BlockStyle>(result.rows,);
}

export async function findById(id: string,): Promise<BlockStyle> {
    const result = await query('SELECT * FROM block_styles WHERE id = $1', [id,],);
    if (result.rows.length === 0) throw new NotFoundError('Block style',);
    return mapRow<BlockStyle>(result.rows[0],);
}

export async function findDefault(): Promise<BlockStyle | null> {
    const result = await query('SELECT * FROM block_styles WHERE is_default = true LIMIT 1',);
    return result.rows.length > 0 ? mapRow<BlockStyle>(result.rows[0],) : null;
}

export async function create(data: Partial<BlockStyle>,): Promise<BlockStyle> {
    const result = await query(
        `INSERT INTO block_styles (name, is_default, background_color, background_image, text_color, text_align,
                                   vertical_align, horizontal_align, font_size, line_height, width, max_width,
                                   min_height, height, padding, margin, gap, overflow_x, overflow_y)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
            data.name,
            data.isDefault || false,
            data.backgroundColor,
            data.backgroundImage,
            data.textColor,
            data.textAlign,
            data.verticalAlign,
            data.horizontalAlign,
            data.fontSize,
            data.lineHeight,
            data.width,
            data.maxWidth,
            data.minHeight,
            data.height,
            data.padding,
            data.margin,
            data.gap,
            data.overflowX,
            data.overflowY,
        ],
    );
    return mapRow<BlockStyle>(result.rows[0],);
}

export async function update(id: string, data: Partial<BlockStyle>,): Promise<BlockStyle> {
    // Build dynamic update
    const updates: string[] = [];
    const values: unknown[] = [];

    const fields: Record<string, string> = {
        name: 'name',
        isDefault: 'is_default',
        backgroundColor: 'background_color',
        backgroundImage: 'background_image',
        textColor: 'text_color',
        textAlign: 'text_align',
        verticalAlign: 'vertical_align',
        horizontalAlign: 'horizontal_align',
        fontSize: 'font_size',
        lineHeight: 'line_height',
        width: 'width',
        maxWidth: 'max_width',
        minHeight: 'min_height',
        height: 'height',
        padding: 'padding',
        margin: 'margin',
        gap: 'gap',
        overflowX: 'overflow_x',
        overflowY: 'overflow_y',
    };

    for (const [camelKey, dbKey,] of Object.entries(fields,)) {
        if ((data as any)[camelKey] !== undefined) {
            values.push((data as any)[camelKey],);
            updates.push(`${dbKey} = $${values.length}`,);
        }
    }

    if (updates.length === 0) return findById(id,);

    // If setting as default, unset other defaults
    if (data.isDefault) {
        await query('UPDATE block_styles SET is_default = false WHERE is_default = true AND id != $1', [id,],);
    }

    values.push(id,);
    const result = await query(
        `UPDATE block_styles SET ${updates.join(', ',)}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
        values,
    );
    if (result.rows.length === 0) throw new NotFoundError('Block style',);
    return mapRow<BlockStyle>(result.rows[0],);
}

export async function remove(id: string,): Promise<void> {
    // Don't allow deleting the default
    const style = await findById(id,);
    if (style.isDefault) throw new Error('Cannot delete the default block style',);

    const result = await query('DELETE FROM block_styles WHERE id = $1 RETURNING id', [id,],);
    if (result.rows.length === 0) throw new NotFoundError('Block style',);
}

export async function findByIds(ids: string[],): Promise<Map<string, BlockStyle>> {
    if (ids.length === 0) return new Map();
    // Build parameterized query for multiple IDs
    const placeholders = ids.map((_, i,) => `$${i + 1}`).join(', ',);
    const result = await query(
        `SELECT * FROM block_styles WHERE id IN (${placeholders})`,
        ids,
    );
    const map = new Map<string, BlockStyle>();
    for (const row of result.rows) {
        const style = mapRow<BlockStyle>(row,);
        map.set(style.id!, style,);
    }
    return map;
}
