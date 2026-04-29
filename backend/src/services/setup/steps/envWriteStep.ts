import { AppError, } from '../../../core/errors';
import type { InstallContext, InstallStep, } from './InstallStep';

/**
 * The point of no return. Buffers built up by every earlier step are
 * flushed atomically (temp + rename) to the project `.env`. Runs LAST
 * because:
 *   - if any prior step fails, we don't want a half-written .env
 *   - file-system writes are the most likely to fail in unusual ways
 *     (permissions, read-only volumes), and we want clear feedback
 *     before risking that
 */
export const envWriteStep: InstallStep = {
    id: 'env-write',
    section: '_global',
    isApplicable: () => true,

    async execute(ctx: InstallContext,): Promise<void> {
        try {
            // Compose the env block from input. (DATABASE_URL is already
            // staged by databaseStep; the rest is consolidated here.)
            const entries: Record<string, string> = {};

            entries.JWT_SECRET = ctx.input.security.jwtSecret;
            if (ctx.input.security.accessTokenExpires) {
                entries.JWT_ACCESS_TOKEN_EXPIRES = ctx.input.security.accessTokenExpires;
            }
            if (ctx.input.security.refreshTokenExpires) {
                entries.JWT_REFRESH_TOKEN_EXPIRES = ctx.input.security.refreshTokenExpires;
            }

            if (ctx.input.redis.enabled && ctx.input.redis.url) {
                entries.REDIS_URL = ctx.input.redis.url;
                if (ctx.input.redis.cacheTtlSeconds !== undefined) {
                    entries.CACHE_TTL_SECONDS = String(ctx.input.redis.cacheTtlSeconds,);
                }
            }

            entries.STORAGE_PROVIDER = ctx.input.storage.provider;
            entries.UPLOAD_MAX_SIZE_MB = String(ctx.input.general.uploadMaxSizeMb,);
            entries.UPLOAD_DIR = ctx.input.general.uploadDir;
            entries.DATA_DIR = ctx.input.general.dataDir;

            if (ctx.input.storage.provider === 's3' && ctx.input.storage.s3) {
                entries.AWS_REGION = ctx.input.storage.s3.region;
                entries.AWS_ACCESS_KEY_ID = ctx.input.storage.s3.accessKeyId;
                entries.AWS_SECRET_ACCESS_KEY = ctx.input.storage.s3.secretAccessKey;
                entries.S3_BUCKET = ctx.input.storage.s3.bucket;
                if (ctx.input.storage.s3.cdnUrl) entries.S3_CDN_URL = ctx.input.storage.s3.cdnUrl;
            }

            if (ctx.input.email.enabled) {
                if (ctx.input.email.host) entries.SMTP_HOST = ctx.input.email.host;
                if (ctx.input.email.port !== undefined) entries.SMTP_PORT = String(ctx.input.email.port,);
                if (ctx.input.email.secure !== undefined) entries.SMTP_SECURE = String(ctx.input.email.secure,);
                if (ctx.input.email.user) entries.SMTP_USER = ctx.input.email.user;
                if (ctx.input.email.pass) entries.SMTP_PASS = ctx.input.email.pass;
                if (ctx.input.email.from) entries.EMAIL_FROM = ctx.input.email.from;
            }

            if (ctx.scratch.adminEmail) entries.ADMIN_EMAILS = String(ctx.scratch.adminEmail,);

            await ctx.envBuffer.setMany(entries,);
            await ctx.envBuffer.flush();
        } catch (error) {
            throw new AppError(
                500,
                'ENV_WRITE_FAILED',
                `Could not write .env file: ${(error as Error).message}`,
                { section: '_global', },
            );
        }
    },
};
