/**
 * Cross-cutting types for installation/setup. Framework-agnostic — these
 * types must not import anything from express, the http layer, or the db
 * client. They describe the shape of data flowing between the detector,
 * the installer, and the wizard frontend.
 */

export type InstallStage = 'env' | 'db' | 'install' | 'ready';

export interface DetectedInfra {
    /** True if DATABASE_URL parses and a connection succeeded inside the timeout. */
    dbReachable: boolean;
    /** Best-effort hint shown to the wizard so it can prefill / mark "✓ detected". */
    dbHint?: { host?: string; port?: number; database?: string; user?: string; };
    /** True if REDIS_URL is set and PING succeeded. */
    redisReachable: boolean;
    /** Number of admin users in the DB. 0 means "no admin yet" (suggest creating one). undefined if DB unreachable. */
    adminCount?: number;
    /** True if env file already declares JWT_SECRET (≥32 chars). */
    hasJwtSecret: boolean;
}

export interface InstallationState {
    needsSetup: boolean;
    stage: InstallStage;
    /** Human-readable list of issues blocking 'ready' state. */
    blockers: string[];
    detected: DetectedInfra;
    /** Set on completion. ISO string. */
    installedAt?: string;
}

export interface ValidationIssue {
    section: string;
    field?: string;
    message: string;
    code?: string;
}
