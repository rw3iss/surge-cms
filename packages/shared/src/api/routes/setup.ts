/**
 * Wire DTOs for the /setup module (first-run installer). The route
 * handlers in `packages/api/src/routes/setup.ts` cast the request body
 * to the tester/installer input types and return the service results
 * verbatim; these DTOs describe those shapes honestly for clients.
 */

// ─── GET /api/v1/setup/status ─────────────────────────────────────

export type InstallStage = 'env' | 'db' | 'install' | 'ready';

/** Infrastructure the detector probed for the wizard's prefill. */
export interface DetectedInfra {
    dbReachable: boolean;
    dbHint?: { host?: string; port?: number; database?: string; user?: string; };
    redisReachable: boolean;
    adminCount?: number;
    hasJwtSecret: boolean;
}

/** GET /api/v1/setup/status — installation state. */
export interface InstallationState {
    needsSetup: boolean;
    stage: InstallStage;
    blockers: string[];
    detected: DetectedInfra;
    /** ISO string, set on completion. */
    installedAt?: string;
}

export type SetupStatusResponse = InstallationState;

// ─── Connection test result (shared by all test-* endpoints) ──────

/** Discriminated result of a "Test connection" probe. */
export type SetupTestResult<TDetail = unknown,> =
    | { ok: true; detail?: TDetail; }
    | { ok: false; error: string; code?: string; };

// ─── POST /api/v1/setup/test-db ───────────────────────────────────

/** Body for POST /api/v1/setup/test-db. URL wins over component fields. */
export interface SetupTestDbBody {
    url?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    timeoutMs?: number;
}

export type SetupTestDbResponse = SetupTestResult<unknown>;

// ─── POST /api/v1/setup/test-redis ────────────────────────────────

export interface SetupTestRedisBody {
    url: string;
    timeoutMs?: number;
}

export type SetupTestRedisResponse = SetupTestResult<{ pong: string; }>;

// ─── POST /api/v1/setup/test-smtp ─────────────────────────────────

export interface SetupTestSmtpBody {
    host: string;
    port: number;
    secure?: boolean;
    user?: string;
    pass?: string;
}

export type SetupTestSmtpResponse = SetupTestResult<{ greeting: string; }>;

// ─── POST /api/v1/setup/test-s3 ───────────────────────────────────

export interface SetupTestS3Body {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

export type SetupTestS3Response = SetupTestResult<{ bucket: string; }>;

// ─── POST /api/v1/setup/generate-jwt ──────────────────────────────

/** POST /api/v1/setup/generate-jwt — a random secret. */
export interface SetupGenerateJwtResponse {
    secret: string;
}

// ─── POST /api/v1/setup/install ───────────────────────────────────

/** A wizard validation issue keyed to a section/field. */
export interface SetupValidationIssue {
    section: string;
    field?: string;
    message: string;
    code?: string;
}

/**
 * Full installer input. Mirrors the wizard's section structure; the
 * route casts the raw body to this and the installer re-validates with
 * zod. Component shapes are intentionally permissive (the installer
 * composes a DB URL from parts, etc.).
 */
export interface SetupInstallBody {
    general: {
        siteName: string;
        siteTagline?: string;
        uploadMaxSizeMb: number;
        uploadDir: string;
        dataDir: string;
    };
    database: {
        mode: 'existing' | 'create';
        url?: string;
        host?: string;
        port?: number;
        database?: string;
        user?: string;
        password?: string;
        createRole?: boolean;
        createDatabase?: boolean;
        superuser?: { user: string; password: string; host?: string; port?: number; };
    };
    adminUser: {
        enabled: boolean;
        email?: string;
        password?: string;
        confirmPassword?: string;
        displayName?: string;
    };
    redis: { enabled: boolean; url?: string; cacheTtlSeconds?: number; };
    storage: {
        provider: 'local' | 's3';
        s3?: {
            region: string;
            accessKeyId: string;
            secretAccessKey: string;
            bucket: string;
            cdnUrl?: string;
        };
    };
    security: {
        jwtSecret: string;
        accessTokenExpires?: string;
        refreshTokenExpires?: string;
    };
    email: {
        enabled: boolean;
        host?: string;
        port?: number;
        secure?: boolean;
        user?: string;
        pass?: string;
        from?: string;
    };
    includeSampleContent?: boolean;
}

/** POST /api/v1/setup/install — success result (process restarts after). */
export interface SetupInstallResponse {
    ok: true;
    appliedSteps: string[];
    restartNeeded: true;
}
