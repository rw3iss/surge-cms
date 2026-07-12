#!/usr/bin/env node
/**
 * `sitesurge` — the SiteSurge CMS operations CLI.
 *
 * A thin front-end over @sitesurge/server: the same installer the visual `/setup`
 * wizard uses, plus migrate/seed/doctor/start. Interactive by default; fully
 * non-interactive via `--config` or `--from-env` (great for Docker & CI).
 */
import { readFileSync, } from 'node:fs';
import { Command, } from 'commander';
import prompts from 'prompts';
import {
    closePool,
    generateJwtSecret,
    getInstallationState,
    initPool,
    type InstallInput,
    loadConfig,
    postgresTester,
    redisTester,
    runInstallation,
    runMigrations,
    runSeed,
    startServer,
} from '@sitesurge/server';

const ok = (m: string,) => console.log(`\x1b[32m✓\x1b[0m ${m}`,);
const info = (m: string,) => console.log(`\x1b[36m▸\x1b[0m ${m}`,);
const fail = (m: string,) => console.error(`\x1b[31m✗\x1b[0m ${m}`,);

// ─── Build InstallInput from environment variables (non-interactive) ──
function inputFromEnv(): InstallInput {
    const e = process.env;
    const s3 = e.STORAGE_PROVIDER === 's3';
    return {
        general: {
            siteName: e.SITE_NAME || 'My Site',
            siteTagline: e.SITE_TAGLINE,
            uploadMaxSizeMb: Number(e.UPLOAD_MAX_SIZE_MB || 500,),
            uploadDir: e.UPLOAD_DIR || './uploads',
            dataDir: e.DATA_DIR || './data',
        },
        database: { mode: 'existing', url: e.DATABASE_URL, },
        adminUser: e.ADMIN_EMAIL
            ? {
                enabled: true,
                email: e.ADMIN_EMAIL,
                password: e.ADMIN_PASSWORD,
                confirmPassword: e.ADMIN_PASSWORD,
                displayName: e.ADMIN_NAME || 'Admin',
            }
            : { enabled: false, },
        redis: e.REDIS_URL ? { enabled: true, url: e.REDIS_URL, } : { enabled: false, },
        storage: s3
            ? {
                provider: 's3',
                s3: {
                    region: e.AWS_REGION || '',
                    accessKeyId: e.AWS_ACCESS_KEY_ID || '',
                    secretAccessKey: e.AWS_SECRET_ACCESS_KEY || '',
                    bucket: e.S3_BUCKET || '',
                    cdnUrl: e.S3_CDN_URL,
                },
            }
            : { provider: 'local', },
        security: { jwtSecret: e.JWT_SECRET || generateJwtSecret().secret, },
        email: e.SMTP_HOST
            ? {
                enabled: true,
                host: e.SMTP_HOST,
                port: Number(e.SMTP_PORT || 587,),
                secure: e.SMTP_SECURE === 'true',
                user: e.SMTP_USER,
                pass: e.SMTP_PASS,
            }
            : { enabled: false, },
    };
}

// ─── Gather InstallInput interactively ──
async function inputInteractive(): Promise<InstallInput> {
    console.log('\nSiteSurge setup — a few questions to initialize your instance.\n',);
    const onCancel = () => { fail('Cancelled.',); process.exit(1,); };

    const g = await prompts([
        { type: 'text', name: 'siteName', message: 'Site name', initial: 'My Site', },
    ], { onCancel, },);
    const db = await prompts([
        {
            type: 'text',
            name: 'url',
            message: 'PostgreSQL connection URL',
            initial: 'postgresql://user:password@localhost:5432/sitesurge',
        },
    ], { onCancel, },);
    const admin = await prompts([
        { type: 'text', name: 'email', message: 'Admin email', },
        { type: 'password', name: 'password', message: 'Admin password (min 8 chars)', },
        { type: 'text', name: 'displayName', message: 'Admin display name', initial: 'Admin', },
    ], { onCancel, },);
    const redis = await prompts([
        { type: 'text', name: 'url', message: 'Redis URL (leave blank to skip caching)', initial: '', },
    ], { onCancel, },);
    const sec = await prompts([
        { type: 'text', name: 'jwtSecret', message: 'JWT secret (leave blank to auto-generate)', initial: '', },
    ], { onCancel, },);

    return {
        general: { siteName: g.siteName, uploadMaxSizeMb: 500, uploadDir: './uploads', dataDir: './data', },
        database: { mode: 'existing', url: db.url, },
        adminUser: {
            enabled: true,
            email: admin.email,
            password: admin.password,
            confirmPassword: admin.password,
            displayName: admin.displayName,
        },
        redis: redis.url ? { enabled: true, url: redis.url, } : { enabled: false, },
        storage: { provider: 'local', },
        security: { jwtSecret: sec.jwtSecret || generateJwtSecret().secret, },
        email: { enabled: false, },
    };
}

const program = new Command();
program
    .name('sitesurge')
    .description('SiteSurge CMS — setup & operations CLI')
    .version('0.1.0');

program
    .command('setup')
    .description('Initialize a SiteSurge instance: connect DB, run migrations, seed, create admin, write .env')
    .option('--config <file>', 'JSON file with the full install input (non-interactive)')
    .option('--from-env', 'Build the install input from environment variables (non-interactive)')
    .option('--env-path <path>', 'Where to write the generated .env (default: ./.env)')
    .action(async (opts: { config?: string; fromEnv?: boolean; envPath?: string; },) => {
        let input: InstallInput;
        if (opts.config) input = JSON.parse(readFileSync(opts.config, 'utf8',),) as InstallInput;
        else if (opts.fromEnv) input = inputFromEnv();
        else input = await inputInteractive();

        info('Running installer…',);
        try {
            const result = await runInstallation(input, opts.envPath ? { envPath: opts.envPath, } : {},);
            ok(`Installed — steps: ${result.appliedSteps.join(', ',)}`,);
            ok('Start the server with:  sitesurge start   (or: node dist/index.js)',);
            process.exit(0,);
        } catch (e) {
            const err = e as { message?: string; details?: { errors?: unknown; }; };
            fail(`Install failed: ${err.message ?? String(e,)}`,);
            if (err.details?.errors) console.error(JSON.stringify(err.details.errors, null, 2,),);
            process.exit(1,);
        }
    },);

program
    .command('migrate')
    .description('Apply pending database migrations')
    .action(async () => {
        loadConfig();
        initPool();
        try {
            const r = await runMigrations();
            ok(`Migrations: ${r.appliedCount} applied${r.appliedCount ? ' — ' + r.appliedFilenames.join(', ',) : ''}`,);
        } catch (e) {
            fail(`Migrate failed: ${(e as Error).message}`,);
            process.exitCode = 1;
        } finally {
            await closePool();
        }
    },);

program
    .command('seed')
    .description('Seed default settings + homepage')
    .option('--sample', 'Include sample content')
    .action(async (opts: { sample?: boolean; },) => {
        loadConfig();
        initPool();
        try {
            await runSeed(undefined, { includeSampleContent: !!opts.sample, },);
            ok('Seeded',);
        } catch (e) {
            fail(`Seed failed: ${(e as Error).message}`,);
            process.exitCode = 1;
        } finally {
            await closePool();
        }
    },);

program
    .command('doctor')
    .description('Check database + Redis connectivity from the current config/.env')
    .action(async () => {
        loadConfig();
        const dbUrl = process.env.DATABASE_URL;
        const redisUrl = process.env.REDIS_URL;
        let bad = false;
        if (dbUrl) {
            const r = await postgresTester.test({ url: dbUrl, },);
            if (r.ok) ok('PostgreSQL reachable',);
            else { fail(`PostgreSQL: ${r.error}${r.code ? ` (${r.code})` : ''}`,); bad = true; }
        } else { info('DATABASE_URL not set',); bad = true; }

        if (redisUrl) {
            const r = await redisTester.test({ url: redisUrl, },);
            if (r.ok) ok('Redis reachable',);
            else fail(`Redis: ${r.error} (caching is optional)`,);
        } else info('REDIS_URL not set (caching optional)',);

        process.exit(bad ? 1 : 0,);
    },);

program
    .command('status')
    .description('Show whether the instance still needs setup')
    .action(async () => {
        loadConfig();
        const s = await getInstallationState(true,);
        console.log(JSON.stringify({ needsSetup: s.needsSetup, stage: s.stage, blockers: s.blockers, }, null, 2,),);
        process.exit(0,);
    },);

program
    .command('start')
    .description('Start the SiteSurge server (equivalent to `node dist/index.js`)')
    .action(async () => {
        await startServer();
    },);

program.parseAsync(process.argv,).catch((e,) => {
    fail((e as Error).message,);
    process.exit(1,);
},);
