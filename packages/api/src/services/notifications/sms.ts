/**
 * SMS through a PROVIDER (Settings → Notifications → SMS). Twilio first (its
 * REST API, no SDK); add AWS SNS as another `SmsProvider`. Messages are kept
 * short — the title + a link.
 */
import { logger, } from '../../utils/logger';
import { getSmsSettings, } from './options';

export interface SmsProvider { send(to: string, text: string,): Promise<void>; }

const twilio = (accountSid: string, authToken: string, from: string,): SmsProvider => ({
    async send(to, text,) {
        const body = new URLSearchParams({ To: to, Body: text, },);
        if (/^MG/i.test(from,)) body.set('MessagingServiceSid', from,);
        else body.set('From', from,);
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid,)}/Messages.json`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`,).toString('base64',)}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
            signal: AbortSignal.timeout(15_000,),
        },);
        if (!res.ok) {
            const err = (await res.json().catch(() => ({}),)) as { message?: string; code?: number; };
            throw new Error(`Twilio ${res.status}: ${err.message ?? res.statusText}`,);
        }
    },
});

/** The configured provider, or null (SMS not set up). */
export async function smsProvider(): Promise<SmsProvider | null> {
    const s = await getSmsSettings();
    if (!s.configured) return null;
    return twilio(s.accountSid, s.authToken, s.fromNumber,);
}

/** E.164 phone numbers only. */
export const isPhone = (v: string,) => /^\+[1-9]\d{6,14}$/.test(v.trim(),);

/** Send one SMS per number. Never throws; returns how many were sent. */
export async function sendSms(numbers: string[], text: string,): Promise<number> {
    const provider = await smsProvider();
    if (!provider) { logger.info('SMS notification skipped: no SMS provider configured',); return 0; }
    let sent = 0;
    for (const n of numbers.map((x,) => x.trim(),).filter(isPhone,)) {
        try { await provider.send(n, text.slice(0, 600,),); sent++; } catch (e) { logger.warn('SMS notification failed', { to: n, error: (e as Error).message, },); }
    }
    return sent;
}
