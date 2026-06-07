import type { ConnectionTester, TestResult, } from './ConnectionTester';

export interface S3TesterInput {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
}

export class S3Tester implements ConnectionTester<S3TesterInput, { bucket: string; }> {
    async test(input: S3TesterInput,): Promise<TestResult<{ bucket: string; }>> {
        try {
            const { S3Client, HeadBucketCommand, } = await import('@aws-sdk/client-s3');
            const client = new S3Client({
                region: input.region,
                credentials: {
                    accessKeyId: input.accessKeyId,
                    secretAccessKey: input.secretAccessKey,
                },
            },);
            await client.send(new HeadBucketCommand({ Bucket: input.bucket, },),);
            client.destroy();
            return { ok: true, detail: { bucket: input.bucket, }, };
        } catch (error) {
            const err = error as Error & { name?: string; };
            return { ok: false, error: err.message, code: err.name, };
        }
    }
}

export const s3Tester = new S3Tester();
