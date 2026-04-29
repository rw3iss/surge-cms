import fs from 'fs/promises';
import path from 'path';
import type { ConfigStore, } from './ConfigStore';

/**
 * Writes config to a `.env` file. Atomic — values are accumulated in
 * memory and flushed via `flush()` (which writes a temp file and
 * renames into place) so a crash mid-write never leaves a torn `.env`.
 *
 * The file is round-tripped: existing comments and unrelated keys are
 * preserved; only keys we explicitly set are updated.
 */
export class EnvFileStore implements ConfigStore {
    private cache: Map<string, string> = new Map();
    private dirty = false;
    private loaded = false;

    constructor(private readonly filePath: string,) {}

    private async load(): Promise<void> {
        if (this.loaded) return;
        try {
            const raw = await fs.readFile(this.filePath, 'utf-8',);
            for (const line of raw.split('\n',)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#',)) continue;
                const eq = line.indexOf('=',);
                if (eq < 0) continue;
                const key = line.slice(0, eq,).trim();
                const value = stripQuotes(line.slice(eq + 1,).trim(),);
                this.cache.set(key, value,);
            }
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code !== 'ENOENT') throw error;
        }
        this.loaded = true;
    }

    async get(key: string,): Promise<string | undefined> {
        await this.load();
        return this.cache.get(key,);
    }

    async has(key: string,): Promise<boolean> {
        await this.load();
        return this.cache.has(key,);
    }

    async set(key: string, value: string,): Promise<void> {
        await this.load();
        this.cache.set(key, value,);
        this.dirty = true;
    }

    async setMany(entries: Record<string, string>,): Promise<void> {
        await this.load();
        for (const [k, v,] of Object.entries(entries,)) this.cache.set(k, v,);
        this.dirty = true;
    }

    /** Atomic write: temp file + rename. Reads the original file again so
     * we can preserve comments and unrelated keys exactly. */
    async flush(): Promise<void> {
        if (!this.dirty) return;
        const original = await safeRead(this.filePath,);
        const merged = mergeIntoFile(original, this.cache,);
        const tmpPath = `${this.filePath}.tmp.${process.pid}`;
        await fs.writeFile(tmpPath, merged, { encoding: 'utf-8', mode: 0o600, },);
        await fs.rename(tmpPath, this.filePath,);
        this.dirty = false;
    }
}

async function safeRead(filePath: string,): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8',);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

function stripQuotes(value: string,): string {
    if (value.length >= 2 && (value.startsWith('"',) && value.endsWith('"',)
        || value.startsWith("'",) && value.endsWith("'",))) {
        return value.slice(1, -1,);
    }
    return value;
}

function quoteIfNeeded(value: string,): string {
    if (value === '') return '';
    if (/[\s#"'$=]/.test(value,)) {
        return `"${value.replace(/(["\\])/g, '\\$1',)}"`;
    }
    return value;
}

/**
 * Merge `cache` into the existing `.env` text. For keys present in the
 * file, the line is replaced in-place (preserving comments above and
 * adjacent lines). New keys are appended at the bottom under a
 * `# Added by setup wizard` header.
 */
function mergeIntoFile(original: string | null, cache: Map<string, string>,): string {
    const lines = original ? original.split('\n',) : [];
    const seen = new Set<string>();

    const out = lines.map((line,) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#',)) return line;
        const eq = line.indexOf('=',);
        if (eq < 0) return line;
        const key = line.slice(0, eq,).trim();
        if (cache.has(key,)) {
            seen.add(key,);
            return `${key}=${quoteIfNeeded(cache.get(key,)!,)}`;
        }
        return line;
    },);

    const newKeys: string[] = [];
    for (const [k, v,] of cache.entries()) {
        if (!seen.has(k,)) newKeys.push(`${k}=${quoteIfNeeded(v,)}`,);
    }
    if (newKeys.length > 0) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('',);
        out.push('# Added by setup wizard', ...newKeys,);
    }
    if (out.length === 0 || out[out.length - 1] !== '') out.push('',);
    return out.join('\n',);
}

/** Resolve the project root `.env` path. Pure helper so the boot code
 * and tests can compute it the same way. */
export function defaultEnvPath(): string {
    return path.resolve(process.cwd(), '.env',);
}
