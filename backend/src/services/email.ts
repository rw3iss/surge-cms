import nodemailer from 'nodemailer';
import { config, } from '../config';
import { logger, } from '../utils/logger';

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
    if (!transporter) {
        if (!config.email.host) {
            throw new Error('Email configuration not set',);
        }

        transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.secure,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        },);
    }

    return transporter;
}

export async function sendEmail(options: EmailOptions,): Promise<void> {
    try {
        const transport = getTransporter();

        await transport.sendMail({
            from: config.email.from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text || options.html.replace(/<[^>]*>/g, '',),
        },);

        logger.info('Email sent successfully', { to: options.to, subject: options.subject, },);
    } catch (error) {
        logger.error('Failed to send email', { error, to: options.to, },);
        throw error;
    }
}

export async function sendWelcomeEmail(email: string, name: string,): Promise<void> {
    await sendEmail({
        to: email,
        subject: 'Welcome to RW!',
        html: `
      <h1>Welcome to RW, ${name}!</h1>
      <p>Thank you for joining our community.</p>
      <p>As a member, you now have access to exclusive content and features.</p>
      <p>Best regards,<br>The RW Team</p>
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
      <p>Your support helps us continue our mission of independent journalism.</p>
      <p>Best regards,<br>The RW Team</p>
    `,
    },);
}

export async function verifyEmailConfig(): Promise<boolean> {
    try {
        if (!config.email.host) {
            logger.warn('Email configuration not set',);
            return false;
        }

        const transport = getTransporter();
        await transport.verify();
        logger.info('Email configuration verified',);
        return true;
    } catch (error) {
        logger.error('Email configuration verification failed', { error, },);
        return false;
    }
}
