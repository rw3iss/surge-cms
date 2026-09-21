import { z, } from 'zod';
import multer from 'multer';
import { tmpdir, } from 'os';
import { rm, } from 'fs/promises';
import type { PaymentCredentialsUpdateBody, SettingsUpdateBody, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { ForbiddenError, ValidationError, } from '../core/errors';
import { requirePermission, } from '../services/permissions';
import * as backup from '../services/backup';
import * as backupDestinations from '../services/backup/destinations';
import * as backupSchedule from '../services/backup/schedule';
import { SECRET_MASK, } from '../services/shop/providers/settings';
import * as serverLogs from '../services/serverLogs';
import * as settings from '../services/settings';
import * as stripeCreds from '../services/payment/credentials';
import * as stripeStatus from '../services/shop/stripeStatus';
import * as swatches from '../services/swatches';
import * as systemUpdate from '../services/systemUpdate';

// ─── Schemas ──────────────────────────────────────────────────────────

const notificationChannelSchema = z.object({
    enabled: z.boolean(),
    addresses: z.array(z.string(),),
},);

const settingsSchema = z.object({
    siteName: z.string().min(1,).max(255,).optional(),
    siteDescription: z.string().optional(),
    logo: z.string().url().optional().nullable(),
    favicon: z.string().url().optional().nullable(),
    socialLinks: z.record(z.string(), z.string(),).optional(),
    contactEmail: z.string().email().optional(),
    analytics: z.object({
        googleAnalyticsId: z.string().optional(),
        facebookPixelId: z.string().optional(),
    },).optional(),
    theme: z.object({
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        accentColor: z.string().optional(),
    },).optional(),
    adminChannel: z.object({
        activeTimeoutSeconds: z.coerce.number().int().min(5,).max(3600,).optional(),
    },).optional(),
    /** Revision retention. 0 keeps every revision (subject only to the
     *  per-entity ceiling); otherwise revisions older than this many days are
     *  swept, except the newest few which always survive. */
    revisions: z.object({
        historyDays: z.coerce.number().int().min(0,).max(3650,).optional(),
    },).optional(),
    /**
     * Per-type notification channel config. Each type key maps to enable +
     * recipient addresses per channel (email/sms/push). Sent by the
     * Settings → Notifications tab.
     */
    notifications: z.record(
        z.string(),
        z.object({
            email: notificationChannelSchema.optional(),
            sms: notificationChannelSchema.optional(),
            push: notificationChannelSchema.optional(),
        },),
    ).optional(),
    /**
     * Feature toggles. The admin Features panel sends this object; each
     * key writes a `<feature>_enabled` row in `site_settings`.
     * Dependency-aware: keys must exist in `FEATURE_REGISTRY`.
     */
    features: z.record(z.string(), z.boolean(),).optional(),
    /**
     * When toggling a feature on, also enable any prerequisites that
     * aren't already enabled. Set by the frontend's FeatureDependencyModal
     * after the operator confirms the cascade.
     */
    enableDependencies: z.boolean().optional(),
    /**
     * Symmetric: when toggling a feature off, also disable any enabled
     * features that declare it as a prerequisite.
     */
    disableDependents: z.boolean().optional(),
},) satisfies z.ZodType<SettingsUpdateBody>;

const keyParams = z.object({ key: z.string(), },);

const paymentContextQuery = z.object({
    context: z.enum(['default', 'shop', 'donations',],).optional(),
},);
const stripeStatusQuery = z.object({
    refresh: z.string().optional(),
    context: z.enum(['default', 'shop', 'donations',],).optional(),
},);
const paymentCredentialsSchema = z.object({
    context: z.enum(['default', 'shop', 'donations',],).optional(),
    useDefault: z.boolean().optional(),
    secretKey: z.string().optional(),
    publishableKey: z.string().optional(),
    webhookSecret: z.string().optional(),
},) satisfies z.ZodType<PaymentCredentialsUpdateBody>;

// ─── Routes ───────────────────────────────────────────────────────────
// Order matters: literal paths (/public, /site-colors/usages/:id, …)
// must precede the /:key catch-all.

/** Uploaded dumps go straight to a temp file: a database dump can be
 *  gigabytes, and multer's memory storage would put all of it on the heap. */
const backupUpload = multer({
    dest: tmpdir(),
    limits: { fileSize: 4 * 1024 * 1024 * 1024, },
},);

/** These two endpoints are the most powerful in the product — a download is
 *  every secret the database holds, a restore overwrites all of it. A machine
 *  key must not be able to do either. */
/** The subject shape the permission manager expects. */
const viewerOf = (user: { id?: string; role?: string; } | undefined,) =>
    ({ id: user?.id, role: user?.role, });

function rejectKeyAuth(apiKey: unknown,): void {
    if (apiKey) {
        throw new ForbiddenError('Backup and restore require an admin login, not an API key',);
    }
}

/** Audited loudly and separately: these are the actions an incident review
 *  looks for first. */
async function logBackupAudit(
    action: 'download' | 'restore',
    ctx: { userId?: string | null; ipAddress?: string; userAgent?: string; },
    detail: Record<string, unknown>,
): Promise<void> {
    const { logAudit, } = await import('../services/audit.js');
    await logAudit({
        userId: ctx.userId ?? '',
        action: `database-${action}`,
        entityType: 'database',
        newValues: detail,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },).catch(() => {});
}

export const settingsRoutes = [

    defineRoute({
        method: 'get', path: '/public', auth: 'public',
        summary: 'Public site settings projection (cached 600s).',
        handler: () => settings.getPublicSettings(),
    },),

    // Payment (Stripe) credentials — site-wide default + per-context overrides.
    // Masked status; secret/webhook are write-only. Context = default|shop|donations.
    defineRoute({
        method: 'get', path: '/payment-credentials', auth: 'admin',
        summary: 'Masked Stripe key status for a payment context (default|shop|donations).',
        input: { query: paymentContextQuery, },
        handler: ({ query, },) => stripeCreds.credentialsStatus(query.context ?? 'default',),
    },),
    defineRoute({
        method: 'put', path: '/payment-credentials', auth: 'admin',
        summary: 'Set/clear Stripe keys (or toggle "use default") for a context.',
        input: { body: paymentCredentialsSchema, },
        handler: ({ body, audit, },) => stripeCreds.updateStripeCredentials(body, audit(),),
    },),
    defineRoute({
        method: 'get', path: '/stripe-status', auth: 'admin',
        summary: 'Stripe connection status for a context (cached ~60s; ?refresh=true re-checks).',
        input: { query: stripeStatusQuery, },
        handler: ({ query, },) => stripeStatus.getStripeStatus(query.refresh === 'true', query.context ?? 'default',),
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'All settings rows with last-editor metadata.',
        handler: () => settings.getAllSettings(),
    },),

    defineRoute({
        method: 'put', path: '/', auth: 'admin',
        summary: 'Update settings; feature toggles run the dependency cascade + lazy migrations.',
        input: { body: settingsSchema, },
        // A feature-cascade rejection throws FeatureCascadeError, which the
        // error middleware maps to a 409 carrying the planner result verbatim
        // (the FeatureDependencyModal reads that exact shape).
        handler: ({ body, audit, },) => settings.updateSettings(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/homepage-hero', auth: 'public',
        summary: 'Homepage hero settings (cached 600s).',
        handler: () => settings.getHomepageHero(),
    },),

    defineRoute({
        method: 'put', path: '/homepage-hero', auth: 'admin',
        summary: 'Update homepage hero settings.',
        handler: ({ body, audit, },) => settings.setHomepageHero(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-header', auth: 'public',
        summary: 'Site header settings (cached 600s).',
        handler: () => settings.getSiteHeader(),
    },),

    defineRoute({
        method: 'put', path: '/site-header', auth: 'admin',
        summary: 'Update site header settings.',
        handler: ({ body, audit, },) => settings.setSiteHeader(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/admin-appearance', auth: 'admin',
        summary: 'Admin chrome appearance tokens (operator-only).',
        handler: () => settings.getAdminAppearance(),
    },),

    defineRoute({
        method: 'put', path: '/admin-appearance', auth: 'admin',
        summary: 'Update admin chrome appearance tokens.',
        handler: ({ body, audit, },) => settings.setAdminAppearance(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-footer', auth: 'public',
        summary: 'Site footer settings (cached 600s).',
        handler: () => settings.getSiteFooter(),
    },),

    defineRoute({
        method: 'put', path: '/site-footer', auth: 'admin',
        summary: 'Update site footer settings.',
        handler: ({ body, audit, },) => settings.setSiteFooter(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-branding', auth: 'public',
        summary: 'Site branding (logo / favicon) settings (cached 600s).',
        handler: () => settings.getSiteBranding(),
    },),

    defineRoute({
        method: 'put', path: '/site-branding', auth: 'admin',
        summary: 'Update site branding settings.',
        handler: ({ body, audit, },) => settings.setSiteBranding(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/appearance', auth: 'public',
        summary: 'Public appearance settings (cached 600s).',
        handler: () => settings.getAppearance(),
    },),

    defineRoute({
        method: 'put', path: '/appearance', auth: 'admin',
        summary: 'Update appearance settings.',
        handler: ({ body, audit, },) => settings.setAppearance(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-colors', auth: 'public',
        summary: 'Site color swatches (cached 600s; auto-migrates legacy shape).',
        handler: () => swatches.list(),
    },),

    defineRoute({
        method: 'put', path: '/site-colors', auth: 'admin',
        summary: 'Replace the site color swatch palette.',
        input: { body: z.array(z.record(z.string(), z.unknown(),),), },
        handler: ({ body, audit, },) => swatches.replace(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/site-colors/usages/:id', auth: 'admin',
        summary: 'Count swatch:{id} references across the DB (delete-confirm UI).',
        input: { params: z.object({ id: z.string(), },), },
        handler: ({ params, },) => swatches.usages(params.id,),
    },),

    defineRoute({
        method: 'post', path: '/features/:key/uninstall', auth: 'admin',
        summary: 'Permanently remove a feature: drop its tables + data. Irreversible.',
        input: {
            params: z.object({ key: z.string(), },),
            body: z.object({ confirm: z.literal(true,), },),
        },
        handler: async ({ params, audit, },) => {
            const result = await settings.uninstallFeature(params.key as never, audit(),);
            return { message: `Removed ${params.key}`, ...result, };
        },
    },),

    /**
     * Backup destination config.
     *
     * The secret is MASKED on read. It is an object-store key that can write to
     * (and, with most policies, read) every database dump you have — which is
     * every password hash on the site. There is no reason for the browser to
     * ever hold it.
     */
    /** Media storage config. Secret masked, as with the backup destination. */
    defineRoute({
        method: 'get', path: '/media-storage', auth: 'admin',
        summary: 'Media storage settings (secret masked).',
        handler: async () => {
            const s = await settings.getMediaStorageSettings();
            return {
                ...s,
                s3: { ...s.s3, secretAccessKey: s.s3.secretAccessKey ? SECRET_MASK : '', },
            };
        },
    },),

    defineRoute({
        method: 'put', path: '/media-storage', auth: 'admin',
        summary: 'Update media storage settings.',
        input: {
            body: z.object({
                provider: z.enum(['local', 's3',],),
                localDir: z.string().max(500,).optional(),
                s3: z.object({
                    endpoint: z.string().max(500,).optional(),
                    region: z.string().max(60,).optional(),
                    bucket: z.string().max(200,).optional(),
                    accessKeyId: z.string().max(200,).optional(),
                    secretAccessKey: z.string().max(400,).optional(),
                    cdnUrl: z.string().max(500,).optional(),
                },).optional(),
            },),
        },
        handler: async ({ body, audit, },) => {
            // An echoed mask means "unchanged" — otherwise opening the form and
            // pressing Save would wipe a working credential.
            const current = await settings.getMediaStorageSettings();
            const secret = body.s3?.secretAccessKey;
            await settings.setMediaStorageSettings({
                ...body,
                s3: {
                    ...(body.s3 ?? {}),
                    secretAccessKey: (!secret || secret === SECRET_MASK)
                        ? current.s3.secretAccessKey
                        : secret,
                },
            }, audit(),);
            return settings.getMediaStorageSettings();
        },
    },),

    defineRoute({
        method: 'post', path: '/media-storage/test', auth: 'admin',
        summary: 'Verify the configured media storage is writable.',
        handler: async () => {
            const s = await settings.getMediaStorageSettings();
            // Reuse the backup destination prober: the shape is the same
            // (endpoint/region/bucket/keys) and a second implementation of
            // "can we actually write here?" would be one to keep in step.
            return backupDestinations.testDestination({
                destination: s.provider === 's3' ? 's3' : 'local',
                local: { path: s.localDir ?? '', },
                s3: { ...s.s3, prefix: '', bucket: s.s3.bucket ?? '', },
                retentionDays: 0,
            } as never,);
        },
    },),

    defineRoute({
        method: 'get', path: '/backup-destination', auth: 'admin',
        summary: 'Backup destination settings (secret masked).',
        handler: async () => {
            const s = await settings.getBackupSettings();
            return {
                ...s,
                s3: {
                    ...s.s3,
                    secretAccessKey: s.s3.secretAccessKey ? SECRET_MASK : '',
                },
            };
        },
    },),

    defineRoute({
        method: 'put', path: '/backup-destination', auth: 'admin',
        summary: 'Update backup destination settings.',
        input: {
            body: z.object({
                destination: z.enum(['download', 'local', 's3',],),
                local: z.object({ path: z.string().max(500,), },).optional(),
                s3: z.object({
                    endpoint: z.string().max(500,).optional(),
                    region: z.string().max(60,).optional(),
                    bucket: z.string().max(200,).optional(),
                    prefix: z.string().max(200,).optional(),
                    accessKeyId: z.string().max(200,).optional(),
                    secretAccessKey: z.string().max(400,).optional(),
                },).optional(),
                // Capped at a year; 0 means keep everything.
                retentionDays: z.number().int().min(0,).max(365,).optional(),
                schedule: z.object({
                    enabled: z.boolean(),
                    frequency: z.enum(['daily', 'weekly', 'monthly',],),
                    timeOfDay: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM',),
                    timezone: z.string().max(64,),
                },).optional(),
            },),
        },
        handler: async ({ body, audit, },) => {
            // An echoed mask means "unchanged" — without this, opening the form
            // and pressing Save would wipe a working credential.
            const current = await settings.getBackupSettings();
            const secret = body.s3?.secretAccessKey;
            const merged = {
                ...body,
                s3: {
                    ...(body.s3 ?? {}),
                    secretAccessKey: (!secret || secret === SECRET_MASK)
                        ? current.s3.secretAccessKey
                        : secret,
                },
            };
            await settings.setBackupSettings(merged, audit(),);
            // Recompute the cursor NOW so enabling or retiming a backup takes
            // effect immediately rather than after the next tick — and so a
            // disabled schedule stops being due.
            await backupSchedule.rescheduleBackups();
            return settings.getBackupSettings();
        },
    },),

    defineRoute({
        method: 'get', path: '/backup-destination/list', auth: 'admin',
        summary: 'List backups stored at the configured destination.',
        handler: async () => backupDestinations.listBackups(await settings.getBackupSettings(),),
    },),

    /**
     * Restore directly from a stored backup.
     *
     * Same `confirm: 'REPLACE'` gate as the upload path — this replaces the
     * entire live database, and a mis-click must not be able to do it.
     */
    defineRoute({
        method: 'post', path: '/backup-destination/restore', auth: 'admin',
        summary: 'Restore the database from a backup at the configured destination.',
        input: { body: z.object({ id: z.string().min(1,), confirm: z.literal('REPLACE',), },), },
        handler: async ({ body, req, },) => {
            await requirePermission(req as never, 'settings.backup:restore',);
            const cfg = await settings.getBackupSettings();
            const path = await backupDestinations.fetchBackup(cfg, body.id,);
            return backup.restoreBackup(path,);
        },
    },),

    defineRoute({
        method: 'post', path: '/backup-destination/test', auth: 'admin',
        summary: 'Verify the configured backup destination is writable.',
        handler: async () => backupDestinations.testDestination(await settings.getBackupSettings(),),
    },),

    /**
     * Generate a dump and store it at the configured destination.
     *
     * Separate from `GET /settings/backup` (which streams a download) so an
     * operator can prove the destination works end to end before relying on it.
     */
    defineRoute({
        method: 'post', path: '/backup-destination/run', auth: 'admin',
        summary: 'Run a backup and store it at the configured destination.',
        handler: async () => {
            const cfg = await settings.getBackupSettings();
            const meta = await backup.createBackup('custom',);
            try {
                const stored = await backupDestinations.storeBackup(cfg, meta.path, meta.filename,);
                const pruned = await backupDestinations.pruneOldBackups(cfg,);
                return {
                    ok: true,
                    location: stored.location,
                    bytes: stored.bytes,
                    detail: pruned > 0 ? `Removed ${pruned} expired backup(s).` : undefined,
                };
            } finally {
                // The temp dump is removed whether or not the upload worked —
                // a failed destination must not fill the server's disk.
                await backup.cleanup(meta,);
            }
        },
    },),

    defineRoute({
        method: 'get', path: '/mailing-lists', auth: 'admin',
        summary: 'Mailing-list sender defaults (From name / From email / Reply-to).',
        handler: () => settings.getMailingListsSettings(),
    },),

    defineRoute({
        method: 'put', path: '/mailing-lists', auth: 'admin',
        summary: 'Update mailing-list sender defaults.',
        input: {
            body: z.object({
                defaultFromName: z.string().max(200,).optional(),
                // Not `.email()`: the field is optional and an empty string is
                // how the operator CLEARS it. Validated as an address only when
                // it carries something.
                defaultFromEmail: z.string().max(320,).optional(),
                defaultReplyTo: z.string().max(320,).optional(),
            },),
        },
        handler: ({ body, audit, },) => settings.setMailingListsSettings(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/users', auth: 'admin',
        summary: 'Users-feature settings (email-verification requirement + verification email).',
        handler: () => settings.getUsersSettings(),
    },),

    defineRoute({
        method: 'put', path: '/users', auth: 'admin',
        summary: 'Update users-feature settings.',
        input: {
            body: z.object({
                requireEmailVerification: z.boolean(),
                verificationEmail: z.object({
                    subject: z.string(),
                    blocks: z.array(z.record(z.string(), z.unknown(),),),
                },),
                autoAddContacts: z.boolean().optional(),
                autoSubscribe: z.boolean().optional(),
                autoSubscribeListId: z.string().nullish(),
            },),
        },
        handler: ({ body, audit, },) => settings.setUsersSettings(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/mail-purposes', auth: 'admin',
        summary: 'Per-purpose email overrides (enable, subject, blocks, auto-send).',
        handler: () => settings.getMailPurposes(),
    },),

    defineRoute({
        method: 'put', path: '/mail-purposes', auth: 'admin',
        summary: 'Replace the per-purpose email overrides.',
        input: {
            // An open record keyed by purpose: the registry owns which keys are
            // meaningful, and validating them here would mean redeploying the
            // API to add a purpose. Unknown keys are simply never read.
            body: z.record(
                z.string(),
                z.object({
                    enabled: z.boolean().optional(),
                    subject: z.string().max(500,).optional(),
                    blocks: z.array(z.record(z.string(), z.unknown(),),).optional(),
                    autoSend: z.boolean().optional(),
                },),
            ),
        },
        handler: ({ body, audit, },) => settings.setMailPurposes(body, audit(),),
    },),

    defineRoute({
        method: 'get', path: '/server-logs', auth: 'admin',
        summary: 'Tail of the server combined log (admin diagnostics panel).',
        input: { query: z.object({ lines: z.coerce.number().int().min(1,).max(10000,).optional(), },), },
        handler: ({ query, },) => serverLogs.getServerLogs((query as { lines?: number; }).lines,),
    },),

    defineRoute({
        method: 'get', path: '/cms-version', auth: 'admin',
        summary: 'Installed CMS version + latest published version (update check).',
        handler: () => systemUpdate.getVersionInfo(),
    },),

    defineRoute({
        method: 'post', path: '/update-cms', auth: 'admin',
        summary: 'Install the latest CMS packages and restart the server. Irreversible; brief downtime.',
        handler: ({ audit, },) => systemUpdate.runUpdate(audit(),),
    },),

    // ─── Backup & restore ─────────────────────────────────────────
    //
    // Declared before the `/:key` catch-alls so `/backup` is not read as a
    // settings key. Both refuse API-key auth: a key is a machine credential
    // that lives in config files, and these two endpoints read out every
    // password hash on the site and overwrite all of its content.

    defineRoute({
        method: 'get', path: '/backup/status', auth: 'admin',
        summary: 'Whether this server can produce database backups (pg_dump present).',
        handler: async ({ user, apiKey, },) => {
            rejectKeyAuth(apiKey,);
            await requirePermission(viewerOf(user,), 'settings.backup:download',);
            return backup.toolingStatus();
        },
    },),

    defineRoute({
        method: 'get', path: '/backup', auth: 'admin', raw: true,
        summary: 'Download a full dump of the site database.',
        input: { query: z.object({ format: z.enum(['custom', 'plain',],).default('custom',), },), },
        handler: async ({ query, user, apiKey, res, audit, },) => {
            rejectKeyAuth(apiKey,);
            await requirePermission(viewerOf(user,), 'settings.backup:download',);

            const meta = await backup.createBackup(query.format,);
            void logBackupAudit('download', audit(), { filename: meta.filename, bytes: meta.bytes, },);

            res.setHeader('Content-Type', 'application/octet-stream',);
            res.setHeader('Content-Disposition', `attachment; filename="${meta.filename}"`,);
            res.setHeader('Content-Length', String(meta.bytes,),);
            // Streamed rather than buffered: a dump can be far larger than the
            // heap, and res.send() would have to hold all of it in memory.
            const { createReadStream, } = await import('fs');
            const stream = createReadStream(meta.path,);
            stream.pipe(res,);
            // Clean up whether the client finished or gave up halfway.
            const done = () => void backup.cleanup(meta,);
            stream.on('close', done,);
            stream.on('error', done,);
            res.on('close', done,);
        },
    },),

    defineRoute({
        method: 'post', path: '/restore', auth: 'admin',
        summary: 'REPLACE the entire database with an uploaded dump. Irreversible.',
        pre: [backupUpload.single('file',),],
        handler: async ({ req, user, apiKey, audit, },) => {
            rejectKeyAuth(apiKey,);
            await requirePermission(viewerOf(user,), 'settings.backup:restore',);

            const file = (req as unknown as { file?: { path: string; size: number; }; }).file;
            if (!file) throw new ValidationError('No backup file was uploaded (field "file").',);

            // Second gate behind the UI's typed confirmation, so a stray POST
            // from a script cannot wipe the site.
            const confirm = (req.body as { confirm?: string; } | undefined)?.confirm;
            if (confirm !== 'REPLACE') {
                await rm(file.path, { force: true, },).catch(() => {},);
                throw new ValidationError(
                    'Restore not confirmed. Send confirm="REPLACE" to proceed.',
                );
            }

            try {
                const result = await backup.restoreBackup(file.path,);
                void logBackupAudit('restore', audit(), {
                    bytes: result.bytes,
                    format: result.format,
                    migrationsApplied: result.migrationsApplied,
                },);
                return result;
            } finally {
                await rm(file.path, { force: true, },).catch(() => {},);
            }
        },
    },),

    defineRoute({
        method: 'put', path: '/:key', auth: 'admin',
        summary: 'Upsert an arbitrary settings row by key.',
        input: { params: keyParams, body: z.object({ value: z.unknown(), },), },
        handler: ({ params, body, audit, },) => settings.setRawKey(params.key, (body as { value: unknown; }).value, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:key', auth: 'admin',
        summary: 'Delete an arbitrary settings row by key.',
        input: { params: keyParams, },
        handler: ({ params, },) => settings.deleteRawKey(params.key,),
    },),
];

export default settingsRoutes;
