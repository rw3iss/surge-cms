/**
 * SMTP provider via Nodemailer. Default provider in V1. Works with
 * any SMTP relay — including SendGrid SMTP, Mailgun SMTP, Postmark
 * SMTP, AWS SES SMTP — so functionally operators have all the major
 * services on day one without us shipping native adapters.
 */
import nodemailer, { Transporter, } from 'nodemailer';
import type { OutboundMessage, } from '@rw/cms-shared';
import { config, } from '../../../config';
import type { MailProvider, } from './types';

export class SmtpMailProvider implements MailProvider {
    private transporter: Transporter | null = null;

    private getTransporter(): Transporter {
        if (this.transporter) return this.transporter;
        const c = config.email;
        if (!c?.host) {
            throw new Error('SMTP not configured — set EMAIL_HOST / SMTP_HOST + port + auth in .env',);
        }
        this.transporter = nodemailer.createTransport({
            host: c.host,
            port: c.port,
            secure: c.secure,
            auth: c.user ? { user: c.user, pass: c.pass, } : undefined,
        },);
        return this.transporter;
    }

    async send(msg: OutboundMessage,): Promise<{ providerId?: string; }> {
        const transport = this.getTransporter();
        const from = msg.fromName
            ? `"${msg.fromName.replace(/"/g, '\\"',)}" <${msg.fromEmail}>`
            : msg.fromEmail;
        const info = await transport.sendMail({
            from,
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            replyTo: msg.replyTo,
            headers: msg.headers,
        },);
        return { providerId: info.messageId, };
    }

    async verify(): Promise<boolean> {
        try {
            const t = this.getTransporter();
            await t.verify();
            return true;
        } catch {
            return false;
        }
    }
}
