/**
 * Fonts repository.
 *
 * Operator-uploaded font assets. Files live on disk under
 * `{config.upload.dir}/fonts/{file_name}` and are served via the
 * existing `/uploads` static handler. This module owns the metadata
 * row only — the route layer (or SDK) handles writing the file.
 */
import { query, } from '../db';
import { mapRow, mapRows, } from '../utils/mapRow';

export interface Font {
    id: string;
    customId: string;
    originalName: string;
    fileName: string;
    format: string;
    sizeBytes: number;
    familyName?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * URL the browser uses to fetch this font's binary. The file is
 * stored under `{upload.dir}/fonts/` and served via the existing
 * `/uploads` static mount.
 */
export function fontUrl(font: Pick<Font, 'fileName'>,): string {
    return `/uploads/fonts/${encodeURIComponent(font.fileName,)}`;
}

export async function listFonts(): Promise<Font[]> {
    const result = await query(
        `SELECT * FROM fonts ORDER BY created_at ASC`,
    );
    return mapRows<Font>(result.rows,);
}

export async function findFontById(id: string,): Promise<Font | null> {
    const result = await query(
        `SELECT * FROM fonts WHERE id = $1`,
        [id,],
    );
    if (result.rows.length === 0) return null;
    return mapRow<Font>(result.rows[0],);
}

export async function findFontByCustomId(customId: string,): Promise<Font | null> {
    const result = await query(
        `SELECT * FROM fonts WHERE custom_id = $1`,
        [customId,],
    );
    if (result.rows.length === 0) return null;
    return mapRow<Font>(result.rows[0],);
}

/**
 * Pick the next available auto-generated id (font1, font2, ...).
 * Scans existing rows whose custom_id matches `font<N>` and returns
 * one past the highest N. If the operator has manually set IDs that
 * don't follow the pattern, those are ignored — auto-numbers stay
 * dense within the auto sequence.
 */
export async function allocateNextCustomId(): Promise<string> {
    const result = await query<{ custom_id: string; }>(
        `SELECT custom_id FROM fonts WHERE custom_id ~ '^font[0-9]+$'`,
    );
    let max = 0;
    for (const row of result.rows) {
        const m = row.custom_id.match(/^font(\d+)$/,);
        if (m) {
            const n = parseInt(m[1], 10,);
            if (Number.isFinite(n,) && n > max) max = n;
        }
    }
    return `font${max + 1}`;
}

export interface CreateFontInput {
    customId: string;
    originalName: string;
    fileName: string;
    format: string;
    sizeBytes: number;
    familyName?: string | null;
}

export async function createFont(input: CreateFontInput,): Promise<Font> {
    const result = await query(
        `INSERT INTO fonts (custom_id, original_name, file_name, format, size_bytes, family_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
            input.customId,
            input.originalName,
            input.fileName,
            input.format,
            input.sizeBytes,
            input.familyName ?? null,
        ],
    );
    return mapRow<Font>(result.rows[0],);
}

export async function deleteFont(id: string,): Promise<Font | null> {
    const result = await query(
        `DELETE FROM fonts WHERE id = $1 RETURNING *`,
        [id,],
    );
    if (result.rows.length === 0) return null;
    return mapRow<Font>(result.rows[0],);
}
