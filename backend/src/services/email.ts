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
        await provider.send({
            to: options.to,
            fromName: options.fromName,
            fromEmail: options.fromEmail ?? config.email.from ?? 'no-reply@example.com',
            replyTo: options.replyTo,
            subject: options.subject,
            html: options.html,
            headers: options.headers,
        },);
        logger.info('Email sent', { to: options.to, subject: options.subject, },);
    } catch (error) {
        logger.error('Failed to send email', { error, to: options.to, },);
        throw error;
    }
}

export async function sendWelcomeEmail(email: string, name: string,): Promise<void> {
    await sendEmail({
        to: email,
        subject: 'Welcome!',
        html: `
      <h1>Welcome, ${name}!</h1>
      <p>Thank you for joining.</p>
      <p>As a member, you now have access to exclusive content and features.</p>
    `,
    },);
}

export async function sendDonationThankYou(
    email: string,
    name: string,
    amount: number,
    campaignTitle?: string,
): Promise<void> {
    const amountFormatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    },).format(amount / 100,);

    await sendEmail({
        to: email,
        subject: 'Thank You for Your Donation!',
        html: `
      <h1>Thank You, ${name}!</h1>
      <p>We received your generous donation of ${amountFormatted}${
            campaignTitle ? ` to our "${campaignTitle}" campaign` : ''
        }.</p>
      <p>Your support helps us continue our mission.</p>
    `,
    },);
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
