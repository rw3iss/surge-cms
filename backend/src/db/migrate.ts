import fs from 'fs';
import path from 'path';
import { logger, } from '../utils/logger';
import { pool, } from './client';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations',);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql',);
const BASE_MIGRATION_NAME = '000_schema.sql';

async function ensureMigrationsTable(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `,);
}

async function getAppliedMigrations(): Promise<Set<string>> {
    const result = await pool.query(
        'SELECT filename FROM schema_migrations ORDER BY filename',
    );
    return new Set(result.rows.map((row: { filename: string; },) => row.filename),);
}

function getMigrationFiles(): string[] {
    if (!fs.existsSync(MIGRATIONS_DIR,)) {
        return [];
    }
    return fs
        .readdirSync(MIGRATIONS_DIR,)
        .filter((f,) => f.endsWith('.sql',))
        .sort();
}

async function applyMigration(
    filename: string,
    sql: string,
): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(sql,);
        await client.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)',
            [filename,],
        );
        await client.query('COMMIT',);
        logger.info(`Applied migration: ${filename}`,);
    } catch (error) {
        await client.query('ROLLBACK',);
        logger.error(`Migration failed: ${filename}`, { error, },);
        throw error;
    } finally {
        client.release();
    }
}

async function showStatus(): Promise<void> {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();
    const migrationFiles = getMigrationFiles();

    // All migrations: base schema + numbered files
    const allMigrations = [BASE_MIGRATION_NAME, ...migrationFiles,];

    console.log('\nMigration Status',);
    console.log('================\n',);

    let pendingCount = 0;
    for (const filename of allMigrations) {
        const status = applied.has(filename,) ? 'APPLIED' : 'PENDING';
        if (status === 'PENDING') pendingCount++;
        const marker = applied.has(filename,) ? '[x]' : '[ ]';
        console.log(`  ${marker} ${filename}`,);
    }

    // Show applied_at for applied migrations
    const result = await pool.query(
        'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
    );
    if (result.rows.length > 0) {
        console.log('\nApplied migration details:',);
        for (const row of result.rows) {
            console.log(`  ${row.filename} - applied at ${row.applied_at.toISOString()}`,);
        }
    }

    console.log(`\nTotal: ${allMigrations.length} migrations, ${pendingCount} pending\n`,);
}

async function migrate(): Promise<void> {
    try {
        logger.info('Starting database migration...',);

        // Step 1: Ensure schema_migrations table exists
        await ensureMigrationsTable();

        // Step 2: Get already-applied migrations
        const applied = await getAppliedMigrations();

        let appliedCount = 0;

        // Step 3: Apply base schema if not yet tracked
        if (!applied.has(BASE_MIGRATION_NAME,)) {
            // Check if the database already has tables (from a previous manual schema load)
            const tablesExist = await pool.query(
                `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'users'
         ) AS exists`,
            );

            if (tablesExist.rows[0].exists) {
                // Database already has schema, just mark it as applied
                logger.info('Base schema already exists in database, marking as applied...',);
                await pool.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                    [BASE_MIGRATION_NAME,],
                );
            } else {
                logger.info('Applying base schema (schema.sql)...',);
                const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8',);
                await applyMigration(BASE_MIGRATION_NAME, schemaSql,);
            }
            appliedCount++;
        } else {
            logger.info('Base schema already applied, skipping.',);
        }

        // Step 4: Apply numbered migrations in order
        const migrationFiles = getMigrationFiles();

        for (const filename of migrationFiles) {
            if (applied.has(filename,)) {
                logger.debug(`Skipping already applied: ${filename}`,);
                continue;
            }

            const filePath = path.join(MIGRATIONS_DIR, filename,);
            const sql = fs.readFileSync(filePath, 'utf-8',);

            await applyMigration(filename, sql,);
            appliedCount++;
        }

        if (appliedCount === 0) {
            logger.info('Database is up to date. No migrations to apply.',);
        } else {
            logger.info(`Database migration completed. Applied ${appliedCount} migration(s).`,);
        }
    } catch (error) {
        logger.error('Database migration failed', { error, },);
        throw error;
    } finally {
        await pool.end();
    }
}

// CLI entry point
const args = process.argv.slice(2,);

if (args.includes('--status',)) {
    showStatus()
        .catch((error,) => {
            console.error('Failed to get migration status:', error,);
            process.exit(1,);
        },)
        .finally(() => pool.end());
} else {
    migrate().catch((error,) => {
        console.error('Migration failed:', error,);
        process.exit(1,);
    },);
}
