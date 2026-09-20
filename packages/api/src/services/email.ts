/**
 * Transactional email helpers. Thin wrapper over the configured
 * MailProvider so welcome / donation-receipt / mailing-list sends all
 * flow through the same pipeline. Switching providers
 * (`MAIL_PROVIDER=mailgun` etc.) routes every outbound message via
 * the new adapter, no code change required at the call sites.
 */
import { config, } from '../config';
import { logger, } from '../utils/logger';
import { getProvider, } from './mail/providers/factory';
import { finalizeEmail, } from './mail/postProcess';

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
    headers?: Record<string, string>;
}

export async function sendEmail(options: EmailOptions,): Promise<void> {
    try {
        const provider = getProvider();
        // Every transactional email funnels through here, so this is where the
        // two email-vs-web corrections belong:
        //  - relative links (`/posts/x`) are dead in an inbox — absolutise them
        //  - an HTML-only message scores as spam — derive the text alternative
        // `options.text` still wins when a caller wrote one by hand.
        //
        // NOTE the `text` field already existed on EmailOptions and was never
        // forwarded to the provider, so even callers that supplied one sent
        // HTML-only.
        const finalized = finalizeEmail(options.html, config.frontendUrl ?? '',);
        await provider.send({
            to: options.to,
            fromName: options.fromName,
            fromEmail: options.fromEmail ?? config.email.from ?? 'no-reply@example.com',
            replyTo: options.replyTo,
            subject: options.subject,
            html: finalized.html,
            text: options.text ?? finalized.text,
            headers: options.headers,
        },);
        logger.info('Email sent', { to: options.to, subject: options.subject, },);
    } catch (error) {
        logger.error('Failed to send email', { error, to: options.to, },);
        throw error;
    }
}

export async function verifyEmailConfig(): Promise<boolean> {
    try {
        if (!config.email.host) {
            logger.warn('Email configuration not set',);
            return false;
        }
        const ok = await getProvider().verify();
        if (ok) logger.info('Email configuration verified',);
        else logger.warn('Email configuration verification failed',);
        return ok;
    } catch (error) {
        logger.error('Email configuration verification failed', { error, },);
        return false;
    }
}
