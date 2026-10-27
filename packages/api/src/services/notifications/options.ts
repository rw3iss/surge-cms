/**
 * Notification OPTIONS (`notification_options`: in-app on/off + retention),
 * the SMS provider (`sms_settings`, secret masked) and the Web Push VAPID keys
 * (env `WEB_PUSH_*` wins; otherwise generated once and stored in
 * `web_push_keys`). All read through a short per-process cache.
 */
import type { NotificationOptions, SmsSettings, } from '@sitesurge/types';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';

export const SECRET_MASK = '••••••••';
const TTL_MS = 30_000;
const DEFAULT_OPTIONS: NotificationOptions = { inAppEnabled: false, retentionDays: 90, };

const cache = new Map<string, { at: number; value: unknown; }>();

async function readRow<T,>(key: string,): Promise<Partial<T> | null> {
    const hit = cache.get(key,);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Partial<T> | null;
    const r = await query<{ value: Partial<T>; }>(`SELECT value FROM site_settings WHERE key = $1`, [key,],).catch(() => ({ rows: [], }),);
    const value = r.rows[0]?.value ?? null;
    cache.set(key, { at: Date.now(), value, },);
    return value;
}

async function writeRow(key: string, value: unknown, actor: string | null,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, JSON.stringify(value,), uuidOrNull(actor,),],
    );
    cache.delete(key,);
}

// ─── Options ───

export async function getNotificationOptions(): Promise<NotificationOptions> {
    return { ...DEFAULT_OPTIONS, ...(await readRow<NotificationOptions>('notification_options',) ?? {}), };
}

export async function setNotificationOptions(body: Partial<NotificationOptions>, actor: string | null,): Promise<NotificationOptions> {
    const next = { ...await getNotificationOptions(), };
    if (body.inAppEnabled !== undefined) next.inAppEnabled = body.inAppEnabled === true;
    if (body.retentionDays !== undefined) {
        if (!Number.isInteger(body.retentionDays,) || body.retentionDays < 1 || body.retentionDays > 3650) throw new ValidationError('Keep notifications 1–3650 days.',);
        next.retentionDays = body.retentionDays;
    }
    await writeRow('notification_options', next, actor,);
    return next;
}

// ─── SMS provider ───

const EMPTY_SMS: SmsSettings = { provider: 'none', accountSid: '', authToken: '', fromNumber: '', };

/** Server use (secret included). */
export async function getSmsSettings(): Promise<SmsSettings> {
    const s = { ...EMPTY_SMS, ...(await readRow<SmsSettings>('sms_settings',) ?? {}), };
    return { ...s, configured: s.provider === 'twilio' && !!s.accountSid && !!s.authToken && !!s.fromNumber, };
}

/** For the admin: the auth token masked. */
export async function smsSettingsForAdmin(): Promise<SmsSettings> {
    const s = await getSmsSettings();
    return { ...s, authToken: s.authToken ? SECRET_MASK : '', };
}

export async function setSmsSettings(body: Partial<SmsSettings>, actor: string | null,): Promise<SmsSettings> {
    const cur = await getSmsSettings();
    const next: SmsSettings = {
        provider: body.provider ?? cur.provider,
        accountSid: (body.accountSid ?? cur.accountSid).trim(),
        authToken: body.authToken === undefined || body.authToken === SECRET_MASK ? cur.authToken : body.authToken.trim(),
        fromNumber: (body.fromNumber ?? cur.fromNumber).trim(),
    };
    if (!['none', 'twilio',].includes(next.provider,)) throw new ValidationError('Unknown SMS provider.',);
    if (next.accountSid && !/^AC[0-9a-f]{32}$/i.test(next.accountSid,)) throw new ValidationError('The Twilio Account SID starts with AC (34 characters).',);
    if (next.fromNumber && !/^(\+[1-9]\d{6,14}|MG[0-9a-f]{32})$/i.test(next.fromNumber,)) {
        throw new ValidationError('From: a phone number in international format (+12155550123) or a Messaging Service SID (MG…).',);
    }
    await writeRow('sms_settings', next, actor,);
    return smsSettingsForAdmin();
}

// ─── Web Push VAPID keys ───

export interface VapidKeys { publicKey: string; privateKey: string; subject: string; }

/** The VAPID keys: env, else stored, else generated now (needs the `web-push` package). */
export async function vapidKeys(): Promise<VapidKeys | null> {
    const subject = config.webPush.subject || `mailto:${config.email.from || 'admin@example.com'}`;
    if (config.webPush.publicKey && config.webPush.privateKey) return { publicKey: config.webPush.publicKey, privateKey: config.webPush.privateKey, subject, };
    const stored = await readRow<VapidKeys>('web_push_keys',);
    if (stored?.publicKey && stored.privateKey) return { publicKey: stored.publicKey, privateKey: stored.privateKey, subject, };
    const wp = await loadWebPush();
    if (!wp) return null;
    const k = wp.generateVAPIDKeys();
    // Insert-only: two workers generating at once keep the first pair.
    await query(
        `INSERT INTO site_settings (key, value) VALUES ('web_push_keys', $1) ON CONFLICT (key) DO NOTHING`,
        [JSON.stringify({ publicKey: k.publicKey, privateKey: k.privateKey, },),],
    );
    cache.delete('web_push_keys',);
    const saved = await readRow<VapidKeys>('web_push_keys',);
    return saved?.publicKey && saved.privateKey ? { publicKey: saved.publicKey, privateKey: saved.privateKey, subject, } : null;
}

export interface WebPushLike {
    generateVAPIDKeys(): { publicKey: string; privateKey: string; };
    setVapidDetails(subject: string, pub: string, priv: string,): void;
    sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string; }; }, payload: string, opts?: { TTL?: number; },): Promise<unknown>;
}

export async function loadWebPush(): Promise<WebPushLike | null> {
    try {
        const specifier = 'web-push';
        const mod = (await import(specifier)) as unknown as { default?: WebPushLike; } & WebPushLike;
        return mod.default ?? mod;
    } catch {
        return null;
    }
}
