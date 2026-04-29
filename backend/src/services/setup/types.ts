/**
 * Wizard input shape. Mirrors the section structure on the frontend so
 * routing errors back to specific fields is straightforward (the
 * `section` discriminator on `ValidationIssue` matches a key here).
 */

export interface GeneralInput {
    siteName: string;
    /** Optional short tagline. Empty string is treated the same as omitted. */
    siteTagline?: string;
    uploadMaxSizeMb: number;
    uploadDir: string;
    dataDir: string;
}

export type DatabaseMode = 'existing' | 'create';

export interface DatabaseInput {
    /**
     * UI hint. `'create'` is shorthand for `createRole=true && createDatabase=true`;
     * `'existing'` defers to the explicit toggles. Backend logic only reads the
     * toggles — `mode` is for the wizard's section state.
     */
    mode: DatabaseMode;
    /** Either a fully-formed connection string ... */
    url?: string;
    /** ... or component fields. The installer composes a URL if `url` is absent. */
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    /** Create the database role (user) if it does not already exist. Requires superuser. */
    createRole?: boolean;
    /** Create the database itself if it does not already exist. Requires superuser. */
    createDatabase?: boolean;
    /** Superuser creds — required when either `createRole` or `createDatabase` is true (or `mode === 'create'`). */
    superuser?: { user: string; password: string; host?: string; port?: number; };
}

export interface AdminUserInput {
    enabled: boolean;
    email?: string;
    password?: string;
    confirmPassword?: string;
    displayName?: string;
}

export interface RedisInput {
    enabled: boolean;
    url?: string;
    cacheTtlSeconds?: number;
}

export type StorageProvider = 'local' | 's3';

export interface StorageInput {
    provider: StorageProvider;
    s3?: {
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucket: string;
        cdnUrl?: string;
    };
}

export interface SecurityInput {
    jwtSecret: string;
    accessTokenExpires?: string;
    refreshTokenExpires?: string;
}

export interface EmailInput {
    enabled: boolean;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    from?: string;
}

export interface InstallInput {
    general: GeneralInput;
    database: DatabaseInput;
    adminUser: AdminUserInput;
    redis: RedisInput;
    storage: StorageInput;
    security: SecurityInput;
    email: EmailInput;
    /** When true, the seeder loads sample pages alongside default settings. Default: false. */
    includeSampleContent?: boolean;
}

/** Section discriminator used in ValidationIssue.section and error mapping. */
export type SectionKey =
    | 'general'
    | 'database'
    | 'admin-user'
    | 'redis'
    | 'storage'
    | 'security'
    | 'email'
    | '_global';
