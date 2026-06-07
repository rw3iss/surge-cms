/**
 * Wizard-side API client for the setup endpoints. The backend's
 * `routes/setup.ts` is the matching server. Keep types here in sync
 * with `services/setup/types.ts` on the backend; we don't share them
 * through `@rw/cms-shared` because the wizard payload is internal and
 * shouldn't pollute the public type surface.
 */
import { api, } from './api';

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
        const res = await api.get<InstallationStatus>('/setup/status',);
        return res.success && res.data ? res.data : null;
    },

    async testDb(input: PostgresProbeInput,): Promise<PostgresProbeResult> {
        const res = await api.post<PostgresProbeResult>('/setup/test-db', input,);
        return res.success && res.data ? res.data : { ok: false, error: res.error?.message, };
    },

    async testRedis(url: string,): Promise<ProbeResult<{ pong: string; }>> {
        const res = await api.post<ProbeResult<{ pong: string; }>>('/setup/test-redis', { url, },);
        return res.success && res.data ? res.data : { ok: false, error: res.error?.message, };
    },

    async testSmtp(input: { host: string; port: number; secure?: boolean; user?: string; pass?: string; },): Promise<ProbeResult> {
        const res = await api.post<ProbeResult>('/setup/test-smtp', input,);
        return res.success && res.data ? res.data : { ok: false, error: res.error?.message, };
    },

    async testS3(input: { region: string; accessKeyId: string; secretAccessKey: string; bucket: string; },): Promise<ProbeResult> {
        const res = await api.post<ProbeResult>('/setup/test-s3', input,);
        return res.success && res.data ? res.data : { ok: false, error: res.error?.message, };
    },

    async generateJwt(): Promise<string> {
        const res = await api.post<{ secret: string; }>('/setup/generate-jwt',);
        if (res.success && res.data) return res.data.secret;
        throw new Error(res.error?.message ?? 'Could not generate secret',);
    },

    async install(payload: InstallPayload,): Promise<{ ok: boolean; data?: InstallSuccess; errors?: ValidationIssue[]; stage?: string; message?: string; }> {
        const res = await api.post<InstallSuccess>('/setup/install', payload,);
        if (res.success && res.data) return { ok: true, data: res.data, };
        const errors = (res.error?.details as { errors?: ValidationIssue[]; stage?: string; })?.errors ?? [];
        const stage = (res.error?.details as { stage?: string; })?.stage;
        // Single-section errors from AppError(409 EmailExists, etc) come through as
        // error.details = { section, field, code }. Promote those into the issue list.
        if (errors.length === 0 && res.error?.details) {
            const d = res.error.details as { section?: string; field?: string; code?: string; };
            if (d.section) {
                errors.push({ section: d.section, field: d.field, message: res.error.message, code: d.code, },);
            }
        }
        return { ok: false, errors, stage, message: res.error?.message, };
    },
};
