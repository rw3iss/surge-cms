/**
 * Whole-database backup and restore.
 *
 * ## What this is for
 *
 * One button that captures everything the CMS knows, and one that puts it back.
 * It shells out to `pg_dump` / `pg_restore` rather than reimplementing them:
 * they already handle sequences, constraint ordering, generated columns and
 * extensions correctly, and any hand-rolled version of that would be subtly
 * wrong in ways only discovered during an emergency.
 *
 * ## What a restore does NOT cover
 *
 * Worth stating plainly, because both are common surprises:
 *
 *  - **Uploaded files are not in the database.** Media lives on disk or in S3/R2
 *    and is untouched by a restore. Restoring an older dump therefore leaves
 *    rows pointing at files that may since have been deleted, and leaves newer
 *    files orphaned. Images break; the CMS does not.
 *  - **The `.env` is not in the database.** Credentials, API keys and provider
 *    settings that live in environment variables are unaffected.
 *
 * ## Why the restore is the most dangerous thing in the product
 *
 * It replaces `users` too — including the account performing the restore. If the
 * dump comes from a different site, the operator locks themselves out and the
 * only way back is shell access to the server. That is why this is sysadmin-only,
 * refuses API-key auth, and requires typing the site name to confirm.
 */
import { spawn, } from 'child_process';
import { createReadStream, } from 'fs';
import { mkdtemp, rm, stat, writeFile, } from 'fs/promises';
import { tmpdir, } from 'os';
import { join, } from 'path';
import type { Readable, } from 'stream';
import { config, } from '../config';
import { AppError, ValidationError, } from '../core/errors';
import { logger, } from '../utils/logger';
import * as cache from './cache';
import { query, resetPool, } from '../db';

/** Guard against a runaway dump/restore holding a worker forever. */
const DUMP_TIMEOUT_MS = 10 * 60 * 1000;
const RESTORE_TIMEOUT_MS = 20 * 60 * 1000;

/** Custom-format dumps are compressed and restore with `pg_restore`; plain SQL
 *  is accepted on the way in for dumps produced elsewhere. */
export type BackupFormat = 'custom' | 'plain';

export interface BackupMeta {
    filename: string;
    bytes: number;
    /** Absolute path to the generated file. The caller streams then deletes it. */
    path: string;
    /** Temp directory to remove once the stream has finished. */
    dir: string;
}

function databaseUrl(): string {
    const url = config.database?.url || process.env.DATABASE_URL;
    if (!url) throw new AppError(500, 'BACKUP_NOT_CONFIGURED', 'DATABASE_URL is not configured',);
    return url;
}

/**
 * Run a Postgres CLI tool, returning stderr for diagnostics.
 *
 * The connection string goes in as an argument rather than through the shell:
 * `spawn` without a shell passes argv directly, so a password containing shell
 * metacharacters cannot be reinterpreted as a command.
 */
function run(
    bin: string,
    args: string[],
    timeoutMs: number,
    stdinFrom?: Readable,
): Promise<{ code: number; stderr: string; }> {
    return new Promise((resolve, reject,) => {
        const child = spawn(bin, args, { stdio: [stdinFrom ? 'pipe' : 'ignore', 'ignore', 'pipe',], },);
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGKILL',);
            reject(new AppError(504, 'BACKUP_TIMEOUT', `${bin} timed out after ${Math.round(timeoutMs / 1000,)}s`,),);
        }, timeoutMs,);

        child.stderr?.on('data', (d,) => {
            // Bounded: a pathological dump could otherwise emit megabytes of
            // warnings and take the process's memory with it.
            if (stderr.length < 64_000) stderr += String(d,);
        },);

        child.on('error', (err,) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer,);
            const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
                ? `${bin} is not installed on this server. Install the PostgreSQL client tools to use backup and restore.`
                : `${bin} failed to start: ${err.message}`;
            reject(new AppError(500, 'BACKUP_TOOL_MISSING', msg,),);
        },);

        child.on('close', (code,) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer,);
            resolve({ code: code ?? -1, stderr, },);
        },);

        if (stdinFrom) {
            stdinFrom.pipe(child.stdin!,);
            stdinFrom.on('error', () => child.kill(),);
        }
    },);
}

/** A filename that sorts chronologically and says where it came from. */
function backupFilename(format: BackupFormat,): string {
    const host = (process.env.SITE_HOST || 'sitesurge').replace(/[^a-z0-9.-]/gi, '-',);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-',).slice(0, 19,);
    return `${host}-${stamp}.${format === 'custom' ? 'dump' : 'sql'}`;
}

/**
 * Dump the whole database to a temp file.
 *
 * Written to disk rather than streamed straight to the response so a failure
 * surfaces as a clean JSON error. Streaming would have already sent a 200 and
 * the download would just end early — a truncated backup that looks successful
 * is far worse than an error message.
 */
export async function createBackup(format: BackupFormat = 'custom',): Promise<BackupMeta> {
    const dir = await mkdtemp(join(tmpdir(), 'sitesurge-backup-',),);
    const filename = backupFilename(format,);
    const path = join(dir, filename,);

    const args = [
        databaseUrl(),
        '--no-owner',       // restores into whatever role the target uses
        '--no-privileges',  // ditto for GRANTs
        '--file', path,
    ];
    if (format === 'custom') {
        args.push('--format=custom', '--compress=6',);
    } else {
        // `--clean --if-exists` has to be baked into a PLAIN dump: unlike the
        // custom format, psql has no way to add it at restore time. Without it
        // every CREATE hits an existing object, the restore reports hundreds of
        // "already exists" errors, and the data is appended to the old rows
        // rather than replacing them.
        args.push('--format=plain', '--clean', '--if-exists',);
    }

    const { code, stderr, } = await run('pg_dump', args, DUMP_TIMEOUT_MS,);
    if (code !== 0) {
        await rm(dir, { recursive: true, force: true, },).catch(() => {},);
        logger.error('pg_dump failed', { code, stderr: stderr.slice(0, 2000,), },);
        throw new AppError(500, 'BACKUP_FAILED', `Backup failed: ${stderr.trim().split('\n',).pop() || `pg_dump exited ${code}`}`,);
    }

    const { size, } = await stat(path,);
    logger.info(`Backup created: ${filename} (${size} bytes)`,);
    return { filename, bytes: size, path, dir, };
}

export interface RestoreResult {
    /** Bytes of the uploaded dump that were processed. */
    bytes: number;
    format: BackupFormat;
    /** Migrations applied after the restore, bringing an older dump up to date. */
    migrationsApplied: string[];
    warnings: string[];
}

/** Sniff the format. Custom-format dumps start with the magic string "PGDMP". */
async function detectFormat(path: string,): Promise<BackupFormat> {
    const { open, } = await import('fs/promises');
    const fh = await open(path, 'r',);
    try {
        const buf = Buffer.alloc(5,);
        await fh.read(buf, 0, 5, 0,);
        return buf.toString('latin1',) === 'PGDMP' ? 'custom' : 'plain';
    } finally {
        await fh.close();
    }
}

/**
 * Reject anything that is not a usable dump, BEFORE the database is touched.
 *
 * Without this the restore is dangerously polite about failure: `psql` reads a
 * text file, hits a syntax error on line 1, changes nothing, and exits — and the
 * endpoint would report success because the database still has all its tables.
 * The operator is told their restore worked when their file never applied.
 *
 * Validating up front also means an unusable upload never gets as far as the
 * `--clean` drops, so a typo in the file picker cannot half-empty a live site.
 */
async function validateDump(path: string, format: BackupFormat,): Promise<void> {
    if (format === 'custom') {
        // pg_restore --list parses the archive's table of contents without
        // connecting to any database. A file that isn't an archive fails here.
        const { code, stderr, } = await run('pg_restore', ['--list', path,], 60_000,);
        if (code !== 0) {
            throw new ValidationError(
                'That file is not a readable PostgreSQL dump. '
                    + (stderr.trim().split('\n',)[0] ?? ''),
            );
        }
        return;
    }

    // Plain SQL: look for the statements any real dump must contain. Reading a
    // bounded prefix keeps this cheap on a multi-gigabyte file.
    const { open, } = await import('fs/promises');
    const fh = await open(path, 'r',);
    try {
        const buf = Buffer.alloc(Math.min(256 * 1024, (await fh.stat()).size,),);
        await fh.read(buf, 0, buf.length, 0,);
        const head = buf.toString('utf8',);
        const looksLikeDump = /^\s*(--|SET |CREATE |COPY |INSERT INTO |ALTER |DROP )/im.test(head,)
            && /(CREATE TABLE|COPY .* FROM stdin|INSERT INTO|CREATE SCHEMA)/i.test(head,);
        if (!looksLikeDump) {
            throw new ValidationError(
                'That file does not look like a PostgreSQL dump — no CREATE TABLE, COPY or '
                    + 'INSERT statements were found. Nothing was changed.',
            );
        }
    } finally {
        await fh.close();
    }
}

/**
 * Replace the live database with an uploaded dump.
 *
 * Ordering matters and is deliberate:
 *
 *  1. A safety dump of the CURRENT database is taken first and its path
 *     returned in the log — if the uploaded file turns out to be the wrong one,
 *     that is the only way back.
 *  2. `pg_restore --clean --if-exists` drops and recreates each object. This is
 *     NOT transactional across the whole restore: `--single-transaction` cannot
 *     be combined with parallelism and fails outright on any pre-existing-object
 *     mismatch, which makes a partial restore likelier, not less likely.
 *  3. Migrations run afterwards, because an older dump carries an older schema
 *     AND an older `schema_migrations` ledger. Without this the code would be
 *     newer than the schema it is querying.
 *  4. Caches are flushed and the pool is reset — every pooled connection is
 *     holding a session against objects that have just been dropped.
 *
 * Non-fatal `pg_restore` errors are common and expected (dropping objects that
 * do not exist yet), so a non-zero exit is reported as a warning rather than a
 * failure when data actually landed.
 */
export async function restoreBackup(uploadPath: string,): Promise<RestoreResult> {
    const { size, } = await stat(uploadPath,);
    if (size === 0) throw new ValidationError('The uploaded backup file is empty.',);

    const format = await detectFormat(uploadPath,);
    const warnings: string[] = [];

    // 0. Prove the file is usable before anything destructive happens.
    await validateDump(uploadPath, format,);

    // 1. Safety copy of what we are about to destroy.
    let safety: BackupMeta | null = null;
    try {
        safety = await createBackup('custom',);
        logger.warn(`Pre-restore safety backup written to ${safety.path}`,);
        warnings.push(`A copy of the previous database was saved on the server at ${safety.path}`,);
    } catch (err) {
        // Refuse rather than proceed: a restore with no way back is not a
        // recovery tool, it is a coin flip.
        throw new AppError(
            500,
            'RESTORE_NO_SAFETY_BACKUP',
            `Refusing to restore: the pre-restore safety backup failed (${(err as Error).message}). `
                + 'Fix that first — restoring without a fallback is unrecoverable.',
        );
    }

    // 2. Restore.
    let code: number;
    let stderr: string;
    if (format === 'custom') {
        ({ code, stderr, } = await run('pg_restore', [
            '--dbname', databaseUrl(),
            '--clean', '--if-exists',
            '--no-owner', '--no-privileges',
            uploadPath,
        ], RESTORE_TIMEOUT_MS,));
    } else {
        // Plain SQL: psql reads it on stdin. ON_ERROR_STOP is deliberately OFF —
        // a plain dump's leading DROPs fail on a fresh object set, and stopping
        // there would abort before any data loaded.
        ({ code, stderr, } = await run('psql', [
            '--dbname', databaseUrl(),
            '--quiet',
            '--set', 'ON_ERROR_STOP=0',
        ], RESTORE_TIMEOUT_MS, createReadStream(uploadPath,),));
    }

    if (stderr.trim()) {
        const lines = stderr.trim().split('\n',).filter((l,) => /error/i.test(l,));
        if (lines.length) {
            warnings.push(`${lines.length} non-fatal restore message(s); first: ${lines[0].slice(0, 300,)}`,);
            logger.warn('Restore reported errors', { count: lines.length, sample: lines.slice(0, 5,), },);
        }
    }

    // 3. Confirm something actually landed before declaring success. A dump of
    //    the wrong database, or a corrupt file, can exit non-zero having done
    //    nothing at all — and reporting that as "restored" is how an operator
    //    discovers the loss hours later.
    await resetPool();
    let tableCount = 0;
    try {
        const r = await query(
            `SELECT COUNT(*)::int AS n FROM information_schema.tables
             WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
        );
        tableCount = r.rows[0]?.n ?? 0;
    } catch (err) {
        throw new AppError(
            500,
            'RESTORE_UNREACHABLE',
            `Restore left the database unreachable: ${(err as Error).message}. `
                + `The previous database was saved at ${safety.path}.`,
        );
    }
    if (tableCount === 0) {
        throw new AppError(
            400,
            'RESTORE_EMPTY',
            'Restore produced an empty database — the file is probably not a dump of this application. '
                + `The previous database was saved at ${safety.path}.`,
        );
    }
    if (code !== 0) {
        warnings.push(`The restore tool exited with code ${code}, but the database has ${tableCount} tables.`,);
    }

    // 4. Bring an older dump's schema up to the running code.
    let migrationsApplied: string[] = [];
    try {
        const { runMigrations, } = await import('../db/migrator.js');
        migrationsApplied = (await runMigrations()).appliedFilenames;
    } catch (err) {
        warnings.push(
            `Restored, but migrations did not complete: ${(err as Error).message}. `
                + 'Restart the server to retry them.',
        );
    }

    // 5. Every cached value now describes a database that no longer exists.
    try {
        await cache.flushAll();
    } catch {
        warnings.push('Restored, but the cache could not be cleared. Restart the server.',);
    }

    logger.warn(`DATABASE RESTORED from uploaded ${format} dump (${size} bytes, ${tableCount} tables)`,);
    return { bytes: size, format, migrationsApplied, warnings, };
}

/** Remove a generated backup once it has been streamed to the client. */
export async function cleanup(meta: Pick<BackupMeta, 'dir'>,): Promise<void> {
    await rm(meta.dir, { recursive: true, force: true, },).catch(() => {},);
}

/** Best-effort probe so the admin can say up front whether this will work,
 *  rather than failing at the moment an operator needs a backup most. */
export async function toolingStatus(): Promise<{ available: boolean; detail: string; }> {
    try {
        const dir = await mkdtemp(join(tmpdir(), 'sitesurge-probe-',),);
        await writeFile(join(dir, 'x',), '',);
        await rm(dir, { recursive: true, force: true, },);
        const { code, stderr, } = await run('pg_dump', ['--version',], 15_000,);
        if (code !== 0) return { available: false, detail: stderr.trim() || 'pg_dump failed', };
        return { available: true, detail: 'pg_dump available', };
    } catch (err) {
        return { available: false, detail: (err as Error).message, };
    }
}
