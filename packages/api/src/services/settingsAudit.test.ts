/**
 * A settings change must be auditable without the audit log becoming a second
 * copy of the credential.
 *
 * Measured on production before this fix: 10 `audit_log` rows carried a
 * non-empty, unmasked `s3.secretAccessKey`. `services/payment/credentials.ts`
 * had the right shape all along — it logs `'set' | 'cleared' | 'unchanged'` —
 * but the generic keyed-settings path logged `newValues: value` whole, and the
 * backup-destination and media-storage settings both hold an S3 secret.
 */
import { describe, expect, it, } from 'vitest';
import { __testing, } from './settings';

const { redactSecrets, } = __testing;

describe('redactSecrets', () => {
    it('redacts an S3 secret access key', () => {
        const out = redactSecrets({
            provider: 's3',
            s3: { bucket: 'b', region: 'r', accessKeyId: 'AKIA…', secretAccessKey: 'REAL-SECRET', },
        },) as Record<string, any>;
        expect(out.s3.secretAccessKey,).toBe('[redacted]',);
        expect(JSON.stringify(out,),).not.toContain('REAL-SECRET',);
    });

    it('keeps the NON-secret fields, which are the auditable part', () => {
        // The point of the log is who changed what; the bucket and region are
        // exactly what a reviewer needs to see.
        const out = redactSecrets({
            provider: 's3',
            s3: { bucket: 'my-bucket', region: 'us-east-2', secretAccessKey: 'x', },
        },) as Record<string, any>;
        expect(out.provider,).toBe('s3',);
        expect(out.s3.bucket,).toBe('my-bucket',);
        expect(out.s3.region,).toBe('us-east-2',);
    });

    it('distinguishes a cleared secret from a set one', () => {
        // "Someone cleared the credential" is a different event from "someone
        // set one", and both matter to a reviewer.
        const set = redactSecrets({ secretAccessKey: 'x', },) as Record<string, any>;
        const cleared = redactSecrets({ secretAccessKey: '', },) as Record<string, any>;
        expect(set.secretAccessKey,).toBe('[redacted]',);
        expect(cleared.secretAccessKey,).toBe('[empty]',);
    });

    it.each([
        'secretAccessKey',
        'secretKey',
        'password',
        'apiToken',
        'webhookSecret',
        'clientCredential',
        'privateKey',
        'apiKey',
    ],)('redacts %s wherever it appears', (field,) => {
        const out = redactSecrets({ [field]: 'REAL', },) as Record<string, unknown>;
        expect(out[field],).toBe('[redacted]',);
    },);

    it('reaches secrets nested inside arrays', () => {
        const out = redactSecrets({ items: [{ password: 'REAL', },], },);
        expect(JSON.stringify(out,),).not.toContain('REAL',);
    });

    it('leaves a value with no secrets byte-identical', () => {
        const input = { provider: 'local', local: { path: '/var/backups', }, retentionDays: 30, };
        expect(redactSecrets(input,),).toEqual(input,);
    });

    it('passes primitives and null through', () => {
        expect(redactSecrets(null,),).toBeNull();
        expect(redactSecrets('plain',),).toBe('plain',);
        expect(redactSecrets(42,),).toBe(42,);
    });
});
