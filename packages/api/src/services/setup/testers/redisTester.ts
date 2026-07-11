import type { ConnectionTester, TestResult, } from './ConnectionTester';

export interface RedisTesterInput {
    url: string;
    timeoutMs?: number;
}

export class RedisTester implements ConnectionTester<RedisTesterInput, { pong: string; }> {
    async test(input: RedisTesterInput,): Promise<TestResult<{ pong: string; }>> {
        const timeoutMs = input.timeoutMs ?? 3_000;
        try {
            const { Redis, } = await import('ioredis');
            const client = new Redis(input.url, {
                lazyConnect: true,
                maxRetriesPerRequest: 1,
                connectTimeout: timeoutMs,
            },);
            try {
                await Promise.race([
                    client.connect(),
                    new Promise<never>((_, reject,) =>
                        setTimeout(() => reject(new Error('Connection timed out',),), timeoutMs,)
                    ),
                ],);
                const pong = await client.ping();
                return { ok: true, detail: { pong, }, };
            } finally {
                client.disconnect();
            }
        } catch (error) {
            return { ok: false, error: (error as Error).message, };
        }
    }
}

export const redisTester = new RedisTester();
