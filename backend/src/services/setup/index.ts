/**
 * Public surface of the setup module. Routes (HTTP layer) import
 * exclusively from here so the internals (steps, stores, testers) can
 * be reorganized without touching adapter code.
 */
export { runInstallation, } from './installer';
export type { InstallResult, InstallFailure, } from './installer';
export type {
    InstallInput,
    GeneralInput,
    DatabaseInput,
    AdminUserInput,
    RedisInput,
    StorageInput,
    SecurityInput,
    EmailInput,
    SectionKey,
} from './types';
export { installInputSchema, zodErrorToIssues, } from './validators/installInput';

// Testers re-exported for use by the routes layer (test-* endpoints).
export { postgresTester, } from './testers/postgresTester';
export type { PostgresTesterInput, } from './testers/postgresTester';
export { redisTester, } from './testers/redisTester';
export type { RedisTesterInput, } from './testers/redisTester';
export { smtpTester, } from './testers/smtpTester';
export type { SmtpTesterInput, } from './testers/smtpTester';
export { s3Tester, } from './testers/s3Tester';
export type { S3TesterInput, } from './testers/s3Tester';
