import type { ConnectionTester, TestResult, } from './ConnectionTester';

export interface SmtpTesterInput {
    host: string;
    port: number;
    secure?: boolean;
    user?: string;
    pass?: string;
}

export class SmtpTester implements ConnectionTester<SmtpTesterInput, { greeting: string; }> {
    async test(input: SmtpTesterInput,): Promise<TestResult<{ greeting: string; }>> {
        try {
            const { default: nodemailer, } = await import('nodemailer');
            const transporter = nodemailer.createTransport({
                host: input.host,
                port: input.port,
                secure: input.secure ?? input.port === 465,
                auth: input.user && input.pass ? { user: input.user, pass: input.pass, } : undefined,
            },);
            const ok = await transporter.verify();
            transporter.close();
            return ok
                ? { ok: true, detail: { greeting: 'verified', }, }
                : { ok: false, error: 'Verification returned false', };
        } catch (error) {
            return { ok: false, error: (error as Error).message, };
        }
    }
}

export const smtpTester = new SmtpTester();
