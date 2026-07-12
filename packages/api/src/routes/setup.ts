import type { SetupGenerateJwtResponse, } from '@sitesurge/types';
import { defineRoute, } from '../api/defineRoute';
import { getInstallationState, } from '../services/installation';
import {
    ensureSetupAllowed,
    generateJwtSecret,
    install,
    postgresTester,
    redisTester,
    s3Tester,
    smtpTester,
} from '../services/setup';
import type {
    PostgresTesterInput,
    RedisTesterInput,
    S3TesterInput,
    SmtpTesterInput,
} from '../services/setup';

/**
 * Thin HTTP adapter for the setup pipeline. All business logic lives in
 * `services/setup/`. Every endpoint rejects when the instance is already
 * installed (via `ensureSetupAllowed`) — except GET /status, which
 * always responds so the frontend can decide whether to redirect to
 * /setup at all.
 *
 * Errors thrown here (AlreadyInstalledError, ValidationError, other
 * AppErrors) funnel into the central error middleware, which produces
 * the same status codes and envelope the legacy handlers built by hand.
 */
export const setupRoutes = [

    defineRoute({
        method: 'get', path: '/status', auth: 'public',
        summary: 'Installation state (whether the instance still needs setup).',
        handler: () => getInstallationState(),
    },),

    defineRoute({
        method: 'post', path: '/test-db', auth: 'public',
        summary: 'Test a PostgreSQL connection (setup-only).',
        handler: async ({ body, },) => {
            await ensureSetupAllowed();
            return postgresTester.test(body as PostgresTesterInput,);
        },
    },),

    defineRoute({
        method: 'post', path: '/test-redis', auth: 'public',
        summary: 'Test a Redis connection (setup-only).',
        handler: async ({ body, },) => {
            await ensureSetupAllowed();
            return redisTester.test(body as RedisTesterInput,);
        },
    },),

    defineRoute({
        method: 'post', path: '/test-smtp', auth: 'public',
        summary: 'Test SMTP credentials (setup-only).',
        handler: async ({ body, },) => {
            await ensureSetupAllowed();
            return smtpTester.test(body as SmtpTesterInput,);
        },
    },),

    defineRoute({
        method: 'post', path: '/test-s3', auth: 'public',
        summary: 'Test S3 credentials (setup-only).',
        handler: async ({ body, },) => {
            await ensureSetupAllowed();
            return s3Tester.test(body as S3TesterInput,);
        },
    },),

    defineRoute({
        method: 'post', path: '/generate-jwt', auth: 'public',
        summary: 'Generate a random JWT secret (setup-only).',
        handler: async (): Promise<SetupGenerateJwtResponse> => {
            await ensureSetupAllowed();
            return generateJwtSecret();
        },
    },),

    defineRoute({
        method: 'post', path: '/install', auth: 'public',
        summary: 'Run the installer, then restart into running mode (responds before restart).',
        handler: async ({ body, },) => {
            await ensureSetupAllowed();
            return install(body,);
        },
    },),
];
