import { z, } from 'zod';

/**
 * Tolerant config schema. Only `NODE_ENV` and `PORT` have hard defaults;
 * everything else is optional so the backend can boot in setup mode with
 * an empty `.env`. Service-layer code is responsible for throwing
 * `ServiceNotConfiguredError` when its keys are missing.
 *
 * The previous `process.exit(1)` behavior on parse failure has been moved
 * to `config/loader.ts` and replaced with a logged warning + a partial
 * config snapshot that triggers setup mode in the installation detector.
 */
export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test',],).default('development',),
    PORT: z.string().transform(Number,).default('3001',),
    API_VERSION: z.string().default('v1',),
    FRONTEND_URL: z.string().url().default('http://localhost:3000',),
    CORS_ORIGINS: z.string().transform((s,) => s.split(',',)).default('http://localhost:3000',),

    DATABASE_URL: z.string().optional(),
    DATABASE_POOL_MIN: z.string().transform(Number,).default('2',),
    DATABASE_POOL_MAX: z.string().transform(Number,).default('10',),

    REDIS_URL: z.string().optional(),
    CACHE_TTL_SECONDS: z.string().transform(Number,).default('300',),

    JWT_SECRET: z.string().min(32,).optional(),
    JWT_ACCESS_TOKEN_EXPIRES: z.string().default('15m',),
    JWT_REFRESH_TOKEN_EXPIRES: z.string().default('7d',),

    PATREON_CLIENT_ID: z.string().optional(),
    PATREON_CLIENT_SECRET: z.string().optional(),
    PATREON_REDIRECT_URI: z.string().url().optional(),
    PATREON_CAMPAIGN_ID: z.string().optional(),
    PATREON_CREATOR_ACCESS_TOKEN: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().transform(Number,).optional(),
    SMTP_SECURE: z.string().transform((s,) => s === 'true').optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    DATA_DIR: z.string().default('./data',),
    UPLOAD_MAX_SIZE_MB: z.string().transform(Number,).default('500',),
    UPLOAD_DIR: z.string().default('./uploads',),
    STORAGE_PROVIDER: z.enum(['local', 's3',],).default('local',),
    ALLOWED_FILE_TYPES: z.string().transform((s,) => s.split(',',)).default(
        'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip',
    ),

    AWS_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_CDN_URL: z.string().optional(),

    FACEBOOK_APP_ID: z.string().optional(),
    FACEBOOK_APP_SECRET: z.string().optional(),
    FACEBOOK_PAGE_ID: z.string().optional(),
    FACEBOOK_ACCESS_TOKEN: z.string().optional(),

    INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),

    TWITTER_API_KEY: z.string().optional(),
    TWITTER_API_SECRET: z.string().optional(),
    TWITTER_BEARER_TOKEN: z.string().optional(),
    TWITTER_USERNAME: z.string().optional(),

    YOUTUBE_API_KEY: z.string().optional(),
    YOUTUBE_CHANNEL_ID: z.string().optional(),

    TIKTOK_CLIENT_KEY: z.string().optional(),
    TIKTOK_CLIENT_SECRET: z.string().optional(),

    SHOPIFY_STORE_DOMAIN: z.string().optional(),
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: z.string().optional(),

    RATE_LIMIT_WINDOW_MS: z.string().transform(Number,).default('900000',),
    RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number,).default('100',),

    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug',],).default('info',),
    LOG_FORMAT: z.string().default('combined',),

    ADMIN_EMAILS: z.string().transform((s,) => s.split(',',).filter(Boolean,),).default('',),
    AUTOLOGIN_ADMIN_LOCALHOST: z.string().transform((s,) => s === 'true').default('false',),
},);

export type EnvVars = z.infer<typeof envSchema>;
