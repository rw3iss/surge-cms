/**
 * Fonts SDK service.
 *
 * Pure-Node interface to the font manager — same code path the HTTP
 * routes use, but importable from scripts, tests, plugins, or other
 * services that aren't going through Express. The route handlers in
 * `routes/fonts.ts` thinly wrap this module so business logic lives in
 * exactly one place.
 *
 * File handling: writes the binary under `{config.upload.dir}/fonts/`
 * and stores a row in the `fonts` table with the operator-supplied
 * (or auto-allocated) `customId`. Deletion removes both.
 */
import fs from 'fs/promises';
import { nanoid, } from 'nanoid';
import path from 'path';
import { config, } from '../config';
import { cache, } from '../services/cache';
import { logger, } from '../utils/logger';
import {
    allocateNextCustomId,
    createFont,
    deleteFont as deleteFontRow,
    findFontByCustomId,
    findFontById,
    type Font,
    fontUrl,
    listFonts,
} from '../repositories/fonts.repo';

const CACHE_KEY = 'fonts:list';
const CACHE_TTL = 600;

/** Directory the binaries live in. Created on first write. */
const FONTS_DIR = path.join(config.upload.dir, 'fonts',);

/** File extensions we accept. */
const ALLOWED_FORMATS: ReadonlySet<string> = new Set([
    'woff2', 'woff', 'ttf', 'otf', 'eot',
],);

/** Validate / normalise an operator-supplied custom id. Returns null
 *  on rejection so callers can decide whether to fall back to auto. */
const CUSTOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function normaliseCustomId(raw: string | undefined | null,): string | null {
    if (!raw) return null;
    const trimmed = String(raw,).trim();
    if (!trimmed) return null;
    if (!CUSTOM_ID_RE.test(trimmed,)) return null;
    return trimmed;
}

function fontFormat(originalName: string,): string {
    const ext = path.extname(originalName,).slice(1,).toLowerCase();
    return ext || 'unknown';
}

export interface FontWithUrl extends Font {
    url: string;
}

function withUrl(font: Font,): FontWithUrl {
    return { ...font, url: fontUrl(font,), };
}

async function invalidateCache(): Promise<void> {
    await cache.del(CACHE_KEY,);
}

/**
 * List all fonts. Read path is cached for 10 minutes — gets
 * invalidated on every create / delete.
 */
export async function list(): Promise<FontWithUrl[]> {
    const cached = await cache.get<FontWithUrl[]>(CACHE_KEY,);
    if (cached) return cached;
    const fonts = await listFonts();
    const enriched = fonts.map(withUrl,);
    await cache.set(CACHE_KEY, enriched, CACHE_TTL,);
    return enriched;
}

export interface CreateFontOptions {
    /** Required — the file binary as a Buffer. */
    buffer: Buffer;
    /** Required — original filename (used to derive the format and as
     *  the displayed source name). */
    originalName: string;
    /** Optional operator id. If absent or invalid, auto-allocate
     *  `font{N}` based on the existing font rows. */
    customId?: string | null;
    /** Optional human label. Defaults to the original filename. */
    familyName?: string | null;
}

/**
 * Create a new font. Writes the binary under `{upload.dir}/fonts/`
 * and inserts a row. Throws on invalid format, missing buffer, or a
 * customId that's already taken.
 */
export async function create(opts: CreateFontOptions,): Promise<FontWithUrl> {
    if (!opts.buffer || opts.buffer.length === 0) {
        throw new Error('Font buffer is empty',);
    }
    const format = fontFormat(opts.originalName,);
    if (!ALLOWED_FORMATS.has(format,)) {
        throw new Error(`Unsupported font format: ${format}. Allowed: ${[...ALLOWED_FORMATS,].join(', ',)}`,);
    }

    // Resolve customId: explicit (after validation) → auto-allocated.
    let customId = normaliseCustomId(opts.customId,);
    if (customId) {
        const existing = await findFontByCustomId(customId,);
        if (existing) throw new Error(`A font with id '${customId}' already exists`,);
    } else {
        customId = await allocateNextCustomId();
    }

    // Write the binary to disk first; only insert the row after the
    // file is durably written so a metadata row never points at a
    // missing file.
    await fs.mkdir(FONTS_DIR, { recursive: true, },);
    const fileName = `${nanoid(12,)}.${format}`;
    const filePath = path.join(FONTS_DIR, fileName,);
    await fs.writeFile(filePath, opts.buffer,);

    try {
        const font = await createFont({
            customId,
            originalName: opts.originalName,
            fileName,
            format,
            sizeBytes: opts.buffer.length,
            familyName: opts.familyName ?? null,
        },);
        await invalidateCache();
        logger.info(`Font uploaded: ${customId} (${opts.originalName}, ${opts.buffer.length}B)`,);
        return withUrl(font,);
    } catch (error) {
        // Best-effort cleanup of the orphaned file. If this fails too
        // we just leak a few bytes of disk; not worth retrying.
        try { await fs.unlink(filePath,); } catch { /* ignore */ }
        throw error;
    }
}

/**
 * Delete a font by id. Removes the file from disk and the row from
 * the table. Returns the deleted row, or null if no font matched.
 */
export async function remove(id: string,): Promise<Font | null> {
    const existing = await findFontById(id,);
    if (!existing) return null;

    const deleted = await deleteFontRow(id,);
    if (!deleted) return null;

    // Best-effort: row is gone whether or not the unlink succeeds.
    try {
        await fs.unlink(path.join(FONTS_DIR, deleted.fileName,),);
    } catch (error) {
        logger.warn(`Could not unlink font file ${deleted.fileName}`, { error: (error as Error).message, },);
    }

    await invalidateCache();
    return deleted;
}

/** Re-export so SDK consumers don't have to reach into the repo. */
export { findFontById, findFontByCustomId, };
