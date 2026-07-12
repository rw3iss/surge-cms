import type {
    SetupStatusResponse, SetupTestDbBody, SetupTestDbResponse, SetupTestRedisBody,
    SetupTestRedisResponse, SetupTestSmtpBody, SetupTestSmtpResponse, SetupTestS3Body,
    SetupTestS3Response, SetupGenerateJwtResponse, SetupInstallBody, SetupInstallResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /setup namespace (public; setup-mode only) — first-run installer. The
 * status probe is never cached. Test endpoints return a discriminated
 * `{ ok: true | false }` result; no cache invalidation (nothing cached).
 */
export class SetupModule extends ModuleBase {
    protected readonly module = 'setup';

    /** GET /setup/status — installation state + infra probes. */
    status(): Promise<SetupStatusResponse> {
        return this.get<SetupStatusResponse>('/setup/status', { options: { cache: false, }, },);
    }

    /** POST /setup/test-db — probe a Postgres connection. */
    testDb(body: SetupTestDbBody,): Promise<SetupTestDbResponse> {
        return this.mutate<SetupTestDbResponse>('POST', '/setup/test-db', { body, },);
    }

    /** POST /setup/test-redis — probe a Redis connection. */
    testRedis(body: SetupTestRedisBody,): Promise<SetupTestRedisResponse> {
        return this.mutate<SetupTestRedisResponse>('POST', '/setup/test-redis', { body, },);
    }

    /** POST /setup/test-smtp — probe an SMTP relay. */
    testSmtp(body: SetupTestSmtpBody,): Promise<SetupTestSmtpResponse> {
        return this.mutate<SetupTestSmtpResponse>('POST', '/setup/test-smtp', { body, },);
    }

    /** POST /setup/test-s3 — probe an S3 bucket. */
    testS3(body: SetupTestS3Body,): Promise<SetupTestS3Response> {
        return this.mutate<SetupTestS3Response>('POST', '/setup/test-s3', { body, },);
    }

    /** POST /setup/generate-jwt — a random JWT secret. */
    generateJwt(): Promise<SetupGenerateJwtResponse> {
        return this.mutate<SetupGenerateJwtResponse>('POST', '/setup/generate-jwt',);
    }

    /** POST /setup/install — run the installer (process restarts after). */
    install(body: SetupInstallBody,): Promise<SetupInstallResponse> {
        return this.mutate<SetupInstallResponse>('POST', '/setup/install', { body, },);
    }
}
