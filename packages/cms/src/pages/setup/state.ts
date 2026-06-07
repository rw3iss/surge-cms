/**
 * Wizard state and helpers. We use a single createStore so individual
 * section components can read/update their own slice without prop
 * drilling, and so a single payload object is ready to ship at submit
 * time.
 */
import { createStore, } from 'solid-js/store';
import type { InstallPayload, ValidationIssue, } from '../../services/setup';

export type WizardState = InstallPayload;

export const initialState: WizardState = {
    general: {
        siteName: 'My Site',
        siteTagline: '',
        uploadMaxSizeMb: 500,
        uploadDir: './uploads',
        dataDir: './data',
    },
    database: {
        mode: 'existing',
        host: 'localhost',
        port: 5432,
        database: 'rw',
        user: 'rw',
        password: '',
    },
    adminUser: {
        enabled: false,
        email: '',
        password: '',
        confirmPassword: '',
        displayName: 'Admin',
    },
    redis: {
        enabled: false,
        url: 'redis://localhost:6379',
        cacheTtlSeconds: 300,
    },
    storage: {
        provider: 'local',
    },
    security: {
        jwtSecret: '',
        accessTokenExpires: '15m',
        refreshTokenExpires: '7d',
    },
    email: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        user: '',
        pass: '',
        from: '',
    },
    includeSampleContent: false,
};

export function createWizardStore() {
    return createStore<WizardState>(initialState,);
}

/**
 * Map a flat list of `ValidationIssue`s (returned by the install
 * endpoint) into a per-field lookup the section components can read
 * cheaply: `errors['database.host']`, `errors['admin-user.email']`.
 */
export function buildErrorMap(issues: ValidationIssue[],): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of issues) {
        const key = issue.field ? `${issue.section}.${issue.field}` : issue.section;
        out[key] = issue.message;
    }
    return out;
}

export function pickError(errors: Record<string, string>, section: string, field?: string,): string | undefined {
    return errors[field ? `${section}.${field}` : section];
}
