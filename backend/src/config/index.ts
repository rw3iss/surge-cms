import dotenv from 'dotenv';
import { z, } from 'zod';

dotenv.config();

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test',],).default('development',),
    PORT: z.string().transform(Number,).default('3001',),
    API_VERSION: z.string().default('v1',),
    FRONTEND_URL: z.string().url().default('http://localhost:3000',),
    CORS_ORIGINS: z.string().transform((s,) => s.split(',',)).default('http://localhost:3000',),

    DATABASE_URL: z.string(),
    DATABASE_POOL_MIN: z.string().transform(Number,).default('2',),
    DATABASE_POOL_MAX: z.string().transform(Number,).default('10',),

    REDIS_URL: z.string().default('redis://localhost:6379',),
    CACHE_TTL_SECONDS: z.string().transform(Number,).default('300',),

    JWT_SECRET: z.string().min(32,),
    JWT_ACCESS_TOKEN_EXPIRES: z.string().default('15m',),
    JWT_REFRESH_TOKEN_EXPIRES: z.string().default('7d',),

    PATREON_CLIENT_ID: z.string(),
    PATREON_CLIENT_SECRET: z.string(),
    PATREON_REDIRECT_URI: z.string().url(),
    PATREON_CAMPAIGN_ID: z.string().optional(),
    PATREON_CREATOR_ACCESS_TOKEN: z.string().optional(),

    STRIPE_SECRET_KEY: z.string(),
    STRIPE_PUBLISHABLE_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().transform(Number,).optional(),
    SMTP_SECURE: z.string().transform((s,) => s === 'true').optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

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

    ADMIN_EMAILS: z.string().transform((s,) => s.split(',',)).default('',),
    AUTOLOGIN_ADMIN_LOCALHOST: z.string().transform((s,) => s === 'true').default('false',),
},);

const parsed = envSchema.safeParse(process.env,);

if (!parsed.success) {
    console.error('Invalid environment variables:',);
    console.error(parsed.error.format(),);
    process.exit(1,);
}

export const config = {
    env: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    apiVersion: parsed.data.API_VERSION,
    frontendUrl: parsed.data.FRONTEND_URL,
    corsOrigins: parsed.data.CORS_ORIGINS,

    database: {
        url: parsed.data.DATABASE_URL,
        poolMin: parsed.data.DATABASE_POOL_MIN,
        poolMax: parsed.data.DATABASE_POOL_MAX,
    },

    redis: {
        url: parsed.data.REDIS_URL,
        cacheTtl: parsed.data.CACHE_TTL_SECONDS,
    },

    jwt: {
        secret: parsed.data.JWT_SECRET,
        accessTokenExpires: parsed.data.JWT_ACCESS_TOKEN_EXPIRES,
        refreshTokenExpires: parsed.data.JWT_REFRESH_TOKEN_EXPIRES,
    },

    patreon: {
        clientId: parsed.data.PATREON_CLIENT_ID,
        clientSecret: parsed.data.PATREON_CLIENT_SECRET,
        redirectUri: parsed.data.PATREON_REDIRECT_URI,
        campaignId: parsed.data.PATREON_CAMPAIGN_ID,
        creatorAccessToken: parsed.data.PATREON_CREATOR_ACCESS_TOKEN || '',
    },

    stripe: {
        secretKey: parsed.data.STRIPE_SECRET_KEY,
        publishableKey: parsed.data.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
    },

    email: {
        host: parsed.data.SMTP_HOST,
        port: parsed.data.SMTP_PORT,
        secure: parsed.data.SMTP_SECURE,
        user: parsed.data.SMTP_USER,
        pass: parsed.data.SMTP_PASS,
        from: parsed.data.EMAIL_FROM,
    },

    upload: {
        maxSizeMb: parsed.data.UPLOAD_MAX_SIZE_MB,
        dir: parsed.data.UPLOAD_DIR,
        storageProvider: parsed.data.STORAGE_PROVIDER,
        allowedTypes: parsed.data.ALLOWED_FILE_TYPES,
    },

    aws: {
        region: parsed.data.AWS_REGION,
        accessKeyId: parsed.data.AWS_ACCESS_KEY_ID,
        secretAccessKey: parsed.data.AWS_SECRET_ACCESS_KEY,
        s3Bucket: parsed.data.S3_BUCKET,
        cdnUrl: parsed.data.S3_CDN_URL,
    },

    social: {
        facebook: {
            appId: parsed.data.FACEBOOK_APP_ID,
            appSecret: parsed.data.FACEBOOK_APP_SECRET,
            pageId: parsed.data.FACEBOOK_PAGE_ID,
            accessToken: parsed.data.FACEBOOK_ACCESS_TOKEN,
        },
        instagram: {
            businessAccountId: parsed.data.INSTAGRAM_BUSINESS_ACCOUNT_ID,
        },
        twitter: {
            apiKey: parsed.data.TWITTER_API_KEY,
            apiSecret: parsed.data.TWITTER_API_SECRET,
            bearerToken: parsed.data.TWITTER_BEARER_TOKEN,
            username: parsed.data.TWITTER_USERNAME,
        },
        youtube: {
            apiKey: parsed.data.YOUTUBE_API_KEY,
            channelId: parsed.data.YOUTUBE_CHANNEL_ID,
        },
        tiktok: {
            clientKey: parsed.data.TIKTOK_CLIENT_KEY,
            clientSecret: parsed.data.TIKTOK_CLIENT_SECRET,
        },
    },

    shopify: {
        storeDomain: parsed.data.SHOPIFY_STORE_DOMAIN,
        storefrontAccessToken: parsed.data.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    },

    rateLimit: {
        windowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
        maxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
    },

    logging: {
        level: parsed.data.LOG_LEVEL,
        format: parsed.data.LOG_FORMAT,
    },

    adminEmails: parsed.data.ADMIN_EMAILS,
    autologinAdminLocalhost: parsed.data.AUTOLOGIN_ADMIN_LOCALHOST,

    isProduction: parsed.data.NODE_ENV === 'production',
    isDevelopment: parsed.data.NODE_ENV === 'development',
    isTest: parsed.data.NODE_ENV === 'test',
} as const;

export type Config = typeof config;
