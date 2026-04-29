import { Pool, } from 'pg';
import { AppError, } from '../../../core/errors';
import { logger, } from '../../../utils/logger';
import { buildPostgresUrl, } from '../testers/postgresTester';
import type { InstallContext, InstallStep, } from './InstallStep';

/**
 * Stage 1: ensure we have a usable Postgres connection and stash both
 * the URL (for later .env write) and a transient pool (used by the
 * remaining steps).
 *
 * Three orthogonal flags drive provisioning:
 *   - `createRole`     → CREATE ROLE if missing
 *   - `createDatabase` → CREATE DATABASE if missing
 *   - `mode === 'create'` → shorthand for both flags (kept for back-compat)
 *
 * When any provisioning is requested, the superuser pool is used to
 * idempotently create what's missing. After provisioning, we connect as
 * the application user — that's the pool subsequent steps run against,
 * and that's the URL written to `.env` at the end.
 */
export const databaseStep: InstallStep = {
    id: 'database',
    section: 'database',
    isApplicable: () => true,

    async execute(ctx: InstallContext,): Promise<void> {
        const db = ctx.input.database;
        const isCreateMode = db.mode === 'create';
        const wantsRole = db.createRole || isCreateMode;
        const wantsDb = db.createDatabase || isCreateMode;

        const appUrl = db.url ?? buildPostgresUrl({
            host: db.host,
            port: db.port,
            database: db.database,
            user: db.user,
            password: db.password,
        },);

        if (wantsRole || wantsDb) {
            await provisionDatabase(db, appUrl, {
                ensureRole: wantsRole,
                ensureDatabase: wantsDb,
                // 'create' mode is contractually a fresh install: refuse to
                // proceed if the DB or role already exist, so we never run
                // migrations against a stale half-installed DB.
                strict: isCreateMode,
            },);
        }

        // Connect as the application user — this is the pool subsequent steps use.
        const pool = new Pool({ connectionString: appUrl, max: 5, },);
        try {
            await pool.query('SELECT 1',);
        } catch (error) {
            await pool.end().catch(() => {/* ignore */});
            throw new AppError(
                400,
                'DB_CONNECTION_FAILED',
                `Could not connect to database: ${(error as Error).message}`,
                { section: 'database', field: db.url ? 'url' : 'host', },
            );
        }

        ctx.pool = pool;
        await ctx.envBuffer.set('DATABASE_URL', appUrl,);
    },

    async rollback(ctx: InstallContext,): Promise<void> {
        if (ctx.pool) {
            await ctx.pool.end().catch(() => {/* ignore */});
            ctx.pool = undefined;
        }
    },
};

interface ProvisionFlags {
    ensureRole: boolean;
    ensureDatabase: boolean;
    /**
     * When true, refuse to proceed if the role or database already exist.
     * Set by the "Create new database" tab so the user can't accidentally
     * run migrations against a half-finished DB from a previous attempt.
     * The "Connect to existing" tab's create-if-missing toggles set this
     * to false (true idempotency).
     */
    strict?: boolean;
}

/**
 * Idempotent provisioning (or strict, when `strict: true`). Connects to
 * the `postgres` system DB as the superuser, then conditionally:
 *   - CREATE ROLE <user> LOGIN PASSWORD '<pass>' (when missing & ensureRole)
 *   - CREATE DATABASE <db> OWNER <user>          (when missing & ensureDatabase)
 *   - GRANTs to ensure the role can use the database even if it was created
 *     by a different owner historically.
 * Closes the superuser pool before returning.
 */
async function provisionDatabase(
    db: InstallContext['input']['database'],
    appUrl: string,
    flags: ProvisionFlags,
): Promise<void> {
    if (!db.superuser) {
        throw new AppError(400, 'SUPERUSER_REQUIRED', 'Superuser credentials required to provision the database', {
            section: 'database',
            field: 'superuser',
        },);
    }
    const target = new URL(appUrl,);
    const dbName = target.pathname.replace(/^\//, '',);
    const appUser = decodeURIComponent(target.username,);
    const appPassword = decodeURIComponent(target.password,);

    const suHost = db.superuser.host ?? target.hostname;
    const suPort = db.superuser.port ?? Number(target.port || 5432,);
    const suUrl = buildPostgresUrl({
        host: suHost,
        port: suPort,
        database: 'postgres',
        user: db.superuser.user,
        password: db.superuser.password,
    },);

    const su = new Pool({ connectionString: suUrl, max: 1, },);
    try {
        if (flags.ensureRole) {
            const roleRes = await su.query<{ exists: boolean; }>(
                `SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
                [appUser,],
            );
            const roleExists = Boolean(roleRes.rows[0]?.exists,);
            if (!roleExists) {
                await su.query(
                    `CREATE ROLE ${quoteIdent(appUser,)} LOGIN PASSWORD '${escapeLiteral(appPassword,)}'`,
                );
                logger.info(`Created role ${appUser}`,);
            } else if (flags.strict) {
                throw new AppError(
                    409,
                    'ROLE_ALREADY_EXISTS',
                    `Role "${appUser}" already exists. Switch to "Connect to existing" and toggle "Create role if missing" if you want to keep it, or pick a different user name.`,
                    { section: 'database', field: 'user', },
                );
            } else {
                // Role exists already — make sure the password matches what was entered.
                // Without this, a typo'd existing role would silently keep its old password
                // and the install would still fail at "connect as app user".
                await su.query(
                    `ALTER ROLE ${quoteIdent(appUser,)} WITH LOGIN PASSWORD '${escapeLiteral(appPassword,)}'`,
                );
                logger.info(`Updated password for existing role ${appUser}`,);
            }
        }

        if (flags.ensureDatabase) {
            const dbRes = await su.query<{ exists: boolean; }>(
                `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
                [dbName,],
            );
            const dbExists = Boolean(dbRes.rows[0]?.exists,);
            if (!dbExists) {
                await su.query(`CREATE DATABASE ${quoteIdent(dbName,)} OWNER ${quoteIdent(appUser,)}`,);
                logger.info(`Created database ${dbName}`,);
            } else if (flags.strict) {
                throw new AppError(
                    409,
                    'DATABASE_ALREADY_EXISTS',
                    `Database "${dbName}" already exists. Switch to "Connect to existing" if you want to use it, or pick a different name. (We won't overwrite an existing database.)`,
                    { section: 'database', field: 'database', },
                );
            }
        }

        // Make sure the app role has full privileges over the target DB even
        // if the DB pre-existed under a different owner. GRANT is a no-op if
        // the privileges are already in place.
        if (flags.ensureRole || flags.ensureDatabase) {
            await su.query(
                `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdent(dbName,)} TO ${quoteIdent(appUser,)}`,
            );

            // Grant the install-time superuser membership in the app role so
            // they can manage the database afterwards (e.g. DROP, ALTER OWNER)
            // without needing actual Postgres superuser status. With default
            // INHERIT, this lets the operator drop/alter the DB even on
            // managed Postgres setups where the "superuser" account is just a
            // role with elevated grants. We don't apply this if the install
            // user is `rw` itself (i.e., somebody is bootstrapping with the
            // app role) or any name that would create a self-loop.
            const suUser = db.superuser.user;
            if (suUser && suUser !== appUser) {
                await su.query(`GRANT ${quoteIdent(appUser,)} TO ${quoteIdent(suUser,)}`,);
                logger.info(`Granted ${appUser} membership to ${suUser} for ongoing management`,);
            }
        }
    } catch (error) {
        // If the error is already a structured AppError (e.g. our strict
        // ROLE_ALREADY_EXISTS thrown above), let it propagate as-is so the
        // frontend can show it inline next to the right field. Only wrap
        // bare driver errors here — those are the ones the user can't
        // reasonably attribute to a specific input.
        if (error instanceof AppError) throw error;
        throw new AppError(
            400,
            'DB_PROVISION_FAILED',
            `Could not provision database: ${(error as Error).message}`,
            { section: 'database', field: 'superuser', },
        );
    } finally {
        await su.end().catch(() => {/* ignore */});
    }
}

function quoteIdent(name: string,): string {
    return `"${name.replace(/"/g, '""',)}"`;
}

function escapeLiteral(value: string,): string {
    return value.replace(/'/g, "''",);
}
