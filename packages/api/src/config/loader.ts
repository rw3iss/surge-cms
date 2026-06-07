import dotenv from 'dotenv';
import { envSchema, type EnvVars, } from './schema';

/**
 * Reloadable config loader. The previous module evaluated env at import
 * time and called `process.exit(1)` on parse failure. The new behavior:
 *   - dotenv is loaded on first call (and again on every explicit reload)
 *   - schema parse failures log to stderr but do NOT exit; an empty/partial
 *     config is returned so the backend can still boot into setup mode
 *   - `loadConfig()` rebuilds the snapshot, `getConfig()` returns the
 *     current one. This is the seam that lets us flip from
 *     "process.exit on install" to "in-process hot-reload" without
 *     touching consumers.
 */

export interface Config {
    env: EnvVars['NODE_ENV'];
    port: number;
    apiVersion: string;
    frontendUrl: string;
    corsOrigins: string[];

    database: {
        url: string | undefined;
        poolMin: number;
        poolMax: number;
    };

    redis: {
        url: string | undefined;
        cacheTtl: number;
    };

    jwt: {
        secret: string | undefined;
        accessTokenExpires: string;
        refreshTokenExpires: string;
    };

    patreon: {
        clientId: string | undefined;
        clientSecret: string | undefined;
        redirectUri: string | undefined;
        campaignId: string | undefined;
        creatorAccessToken: string;
    };

    stripe: {
        secretKey: string | undefined;
        publishableKey: string | undefined;
        webhookSecret: string | undefined;
    };

    email: {
        host: string | undefined;
        port: number | undefined;
        secure: boolean | undefined;
        user: string | undefined;
        pass: string | undefined;
        from: string | undefined;
    };

    mail: {
        provider: 'smtp' | 'mailgun' | 'sendgrid' | 'postmark';
        sendConcurrency: number;
        sendDelayMs: number;
        unsubscribeSecret: string;
    };

    dataDir: string;

    upload: {
        maxSizeMb: number;
        dir: string;
        storageProvider: 'local' | 's3';
        allowedTypes: string[];
    };

    aws: {
        region: string | undefined;
        accessKeyId: string | undefined;
        secretAccessKey: string | undefined;
        s3Bucket: string | undefined;
        cdnUrl: string | undefined;
    };

    social: {
        facebook: {
            appId: string | undefined;
            appSecret: string | undefined;
            pageId: string | undefined;
            accessToken: string | undefined;
        };
        instagram: { businessAccountId: string | undefined; };
        twitter: {
            apiKey: string | undefined;
            apiSecret: string | undefined;
            bearerToken: string | undefined;
            username: string | undefined;
        };
        youtube: { apiKey: string | undefined; channelId: string | undefined; };
        tiktok: { clientKey: string | undefined; clientSecret: string | undefined; };
    };

    shopify: {
        storeDomain: string | undefined;
        storefrontAccessToken: string | undefined;
    };

    rateLimit: { windowMs: number; maxRequests: number; };
    logging: { level: EnvVars['LOG_LEVEL']; format: string; };

    adminEmails: string[];
    autologinAdminLocalhost: boolean;

    isProduction: boolean;
    isDevelopment: boolean;
    isTest: boolean;
}

let _snapshot: Config | null = null;
/** True after a parse error — the snapshot uses defaults but we surface
 * this to callers (notably the installation detector). */
let _parseFailed = false;

function build(parsed: EnvVars,): Config {
    return {
        env: parsed.NODE_ENV,
        port: parsed.PORT,
        apiVersion: parsed.API_VERSION,
        frontendUrl: parsed.FRONTEND_URL,
        corsOrigins: parsed.CORS_ORIGINS,

        database: {
            url: parsed.DATABASE_URL,
            poolMin: parsed.DATABASE_POOL_MIN,
            poolMax: parsed.DATABASE_POOL_MAX,
        },

        redis: {
            url: parsed.REDIS_URL,
            cacheTtl: parsed.CACHE_TTL_SECONDS,
        },

        jwt: {
            secret: parsed.JWT_SECRET,
            accessTokenExpires: parsed.JWT_ACCESS_TOKEN_EXPIRES,
            refreshTokenExpires: parsed.JWT_REFRESH_TOKEN_EXPIRES,
        },

        patreon: {
            clientId: parsed.PATREON_CLIENT_ID,
            clientSecret: parsed.PATREON_CLIENT_SECRET,
            redirectUri: parsed.PATREON_REDIRECT_URI,
            campaignId: parsed.PATREON_CAMPAIGN_ID,
            creatorAccessToken: parsed.PATREON_CREATOR_ACCESS_TOKEN || '',
        },

        stripe: {
            secretKey: parsed.STRIPE_SECRET_KEY,
            publishableKey: parsed.STRIPE_PUBLISHABLE_KEY,
            webhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
        },

        email: {
            host: parsed.SMTP_HOST,
            port: parsed.SMTP_PORT,
            secure: parsed.SMTP_SECURE,
            user: parsed.SMTP_USER,
            pass: parsed.SMTP_PASS,
            from: parsed.EMAIL_FROM,
        },

        mail: {
            provider: (parsed.MAIL_PROVIDER ?? 'smtp') as Config['mail']['provider'],
            sendConcurrency: parsed.MAIL_SEND_CONCURRENCY ?? 10,
            sendDelayMs: parsed.MAIL_SEND_DELAY_MS ?? 50,
            // Falls back to JWT_SECRET so installs without an explicit
            // MAIL_UNSUBSCRIBE_SECRET still get a stable, secret HMAC
            // key. Operators can rotate by setting the env var
            // explicitly — old tokens become invalid, which is fine
            // because re-sends regenerate them.
            unsubscribeSecret: parsed.MAIL_UNSUBSCRIBE_SECRET || parsed.JWT_SECRET || '',
        },

        dataDir: parsed.DATA_DIR,

        upload: {
            maxSizeMb: parsed.UPLOAD_MAX_SIZE_MB,
            dir: parsed.UPLOAD_DIR,
            storageProvider: parsed.STORAGE_PROVIDER,
            allowedTypes: parsed.ALLOWED_FILE_TYPES,
        },

        aws: {
            region: parsed.AWS_REGION,
            accessKeyId: parsed.AWS_ACCESS_KEY_ID,
            secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
            s3Bucket: parsed.S3_BUCKET,
            cdnUrl: parsed.S3_CDN_URL,
        },

        social: {
            facebook: {
                appId: parsed.FACEBOOK_APP_ID,
                appSecret: parsed.FACEBOOK_APP_SECRET,
                pageId: parsed.FACEBOOK_PAGE_ID,
                accessToken: parsed.FACEBOOK_ACCESS_TOKEN,
            },
            instagram: { businessAccountId: parsed.INSTAGRAM_BUSINESS_ACCOUNT_ID, },
            twitter: {
                apiKey: parsed.TWITTER_API_KEY,
                apiSecret: parsed.TWITTER_API_SECRET,
                bearerToken: parsed.TWITTER_BEARER_TOKEN,
                username: parsed.TWITTER_USERNAME,
            },
            youtube: {
                apiKey: parsed.YOUTUBE_API_KEY,
                channelId: parsed.YOUTUBE_CHANNEL_ID,
            },
            tiktok: {
                clientKey: parsed.TIKTOK_CLIENT_KEY,
                clientSecret: parsed.TIKTOK_CLIENT_SECRET,
            },
        },

        shopify: {
            storeDomain: parsed.SHOPIFY_STORE_DOMAIN,
            storefrontAccessToken: parsed.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
        },

        rateLimit: {
            windowMs: parsed.RATE_LIMIT_WINDOW_MS,
            maxRequests: parsed.RATE_LIMIT_MAX_REQUESTS,
        },

        logging: { level: parsed.LOG_LEVEL, format: parsed.LOG_FORMAT, },

        adminEmails: parsed.ADMIN_EMAILS,
        autologinAdminLocalhost: parsed.AUTOLOGIN_ADMIN_LOCALHOST,

        isProduction: parsed.NODE_ENV === 'production',
        isDevelopment: parsed.NODE_ENV === 'development',
        isTest: parsed.NODE_ENV === 'test',
    };
}

/**
 * (Re)load configuration from process.env. Idempotent. Re-reads the
 * `.env` file each time via dotenv (with `override: true`) so a fresh
 * file written by the setup wizard is picked up without restart.
 */
export function loadConfig(): Config {
    dotenv.config({ override: true, },);
    const parsed = envSchema.safeParse(process.env,);
    if (!parsed.success) {
        _parseFailed = true;
        // eslint-disable-next-line no-console
        console.warn(
            '[config] env parse failed; booting with defaults. Issues:',
            parsed.error.format(),
        );
        // Re-parse with empty overrides to get a defaults-only snapshot.
        const fallback = envSchema.safeParse({},);
        _snapshot = build(fallback.success ? fallback.data : ({} as EnvVars),);
        return _snapshot;
    }
    _parseFailed = false;
    _snapshot = build(parsed.data,);
    return _snapshot;
}

export function getConfig(): Config {
    if (!_snapshot) return loadConfig();
    return _snapshot;
}

/** True if the most recent load failed schema validation. The
 * installation detector reads this when computing 'env' stage. */
export function configParseFailed(): boolean {
    return _parseFailed;
}

/** Required-for-running check. The detector uses this to decide whether
 * env-stage setup is needed. */
export function hasMinimalRunningConfig(): boolean {
    const c = getConfig();
    return Boolean(c.database.url) && Boolean(c.jwt.secret) && (c.jwt.secret?.length ?? 0) >= 32;
}
