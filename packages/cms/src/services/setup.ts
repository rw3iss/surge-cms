/**
 * Wizard-side API client for the setup endpoints. The backend's
 * `routes/setup.ts` is the matching server. Keep types here in sync
 * with `services/setup/types.ts` on the backend; we don't share them
 * through `@sitesurge/types` because the wizard payload is internal and
 * shouldn't pollute the public type surface.
 */
import { CmsError, } from '@sitesurge/client';
import { cms, } from './cmsClient';

export type InstallStage = 'env' | 'db' | 'install' | 'ready';

export interface DetectedInfra {
    dbReachable: boolean;
    dbHint?: { host?: string; port?: number; database?: string; user?: string; };
    redisReachable: boolean;
    adminCount?: number;
    hasJwtSecret: boolean;
}

export interface InstallationStatus {
    needsSetup: boolean;
    stage: InstallStage;
    blockers: string[];
    detected: DetectedInfra;
    installedAt?: string;
}

export interface PostgresProbeInput {
    url?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
}

export interface ProbeResult<TDetail = unknown,> {
    ok: boolean;
    detail?: TDetail;
    error?: string;
    code?: string;
}

export type PostgresProbeKind =
    | 'unreachable'
    | 'auth-failed'
    | 'database-missing'
    | 'role-missing'
    | 'timeout'
    | 'unknown';

export interface PostgresProbeResult {
    ok: boolean;
    detail?: { serverVersion: string; serverReachable?: boolean; };
    /** Present on failure only. */
    kind?: PostgresProbeKind;
    /** True when the server itself was reachable, even if the specific DB/role wasn't. */
    serverReachable?: boolean;
    error?: string;
    code?: string;
}

export interface InstallPayload {
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
    security: { jwtSecret: string; accessTokenExpires?: string; refreshTokenExpires?: string; };
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

export interface InstallSuccess {
    ok: true;
    appliedSteps: string[];
    restartNeeded: true;
}

export interface ValidationIssue {
    section: string;
    field?: string;
    message: string;
    code?: string;
}

export const setupApi = {
    async getStatus(): Promise<InstallationStatus | null> {
        try {
            return (await cms.setup.status()) as unknown as InstallationStatus;
        } catch {
            return null;
        }
    },

    async testDb(input: PostgresProbeInput,): Promise<PostgresProbeResult> {
        try {
            return (await cms.setup.testDb(input as any,)) as unknown as PostgresProbeResult;
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Test failed', };
        }
    },

    async testRedis(url: string,): Promise<ProbeResult<{ pong: string; }>> {
        try {
            return (await cms.setup.testRedis({ url, } as any,)) as unknown as ProbeResult<{ pong: string; }>;
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Test failed', };
        }
    },

    async testSmtp(input: { host: string; port: number; secure?: boolean; user?: string; pass?: string; },): Promise<ProbeResult> {
        try {
            return (await cms.setup.testSmtp(input as any,)) as unknown as ProbeResult;
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Test failed', };
        }
    },

    async testS3(input: { region: string; accessKeyId: string; secretAccessKey: string; bucket: string; },): Promise<ProbeResult> {
        try {
            return (await cms.setup.testS3(input as any,)) as unknown as ProbeResult;
        } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : 'Test failed', };
        }
    },

    async generateJwt(): Promise<string> {
        const res = await cms.setup.generateJwt() as unknown as { secret: string; };
        if (res?.secret) return res.secret;
        throw new Error('Could not generate secret',);
    },

    async install(payload: InstallPayload,): Promise<{ ok: boolean; data?: InstallSuccess; errors?: ValidationIssue[]; stage?: string; message?: string; }> {
        try {
            const data = (await cms.setup.install(payload as any,)) as unknown as InstallSuccess;
            return { ok: true, data, };
        } catch (err) {
            const details = err instanceof CmsError ? err.details : undefined;
            const message = err instanceof Error ? err.message : 'Install failed';
            const errors = (details as { errors?: ValidationIssue[]; })?.errors ?? [];
            const stage = (details as { stage?: string; })?.stage;
            // Single-section errors from AppError(409 EmailExists, etc) come through as
            // details = { section, field, code }. Promote those into the issue list.
            if (errors.length === 0 && details) {
                const d = details as { section?: string; field?: string; code?: string; };
                if (d.section) {
                    errors.push({ section: d.section, field: d.field, message, code: d.code, },);
                }
            }
            return { ok: false, errors, stage, message, };
        }
    },
};
