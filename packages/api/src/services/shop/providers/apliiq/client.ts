/**
 * Apliiq HTTP client — HMAC-signed requests against https://api.apliiq.com.
 *
 * ## The signing scheme, and why it is written this way
 *
 * Apliiq's docs give the formula but leave two things ambiguous, and three of
 * the four readings return 401. Determined empirically against the live API:
 *
 *   - `APPID` is the app key **exactly as issued** — a base64-looking string.
 *     It is NOT base64-decoded first.
 *   - The shared secret is used as a **raw UTF-8 string**. It also looks like
 *     base64, and decoding it (the natural instinct) fails.
 *
 * Header: `Authorization: x-apliiq-auth {RTS}:{SIG}:{APPID}:{STATE}` where
 *   RTS   = unix seconds
 *   STATE = a fresh nonce per request
 *   SIG   = base64(HMAC-SHA256(APPID + RTS + STATE + base64(body), secret))
 * and `base64(body)` is the empty string when there is no body.
 */
import crypto from 'crypto';
import type { ProviderConfig, } from '../types';

export const APLIIQ_BASE_URL = 'https://api.apliiq.com';

export interface ApliiqResponse<T = unknown,> {
    status: number;
    json: T | null;
    text: string;
}

export function signApliiq(
    appId: string,
    secret: string,
    bodyJson: string | null,
    rts: string,
    state: string,
): string {
    const content = bodyJson ? Buffer.from(bodyJson, 'utf8',).toString('base64',) : '';
    return crypto.createHmac('sha256', Buffer.from(secret, 'utf8',),)
        .update(`${appId}${rts}${state}${content}`, 'utf8',)
        .digest('base64',);
}

export async function apliiqRequest<T = unknown,>(
    config: ProviderConfig,
    path: string,
    opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; } = {},
): Promise<ApliiqResponse<T>> {
    const appId = String(config.appKey ?? '',);
    const secret = String(config.sharedSecret ?? '',);
    if (!appId || !secret) throw new Error('Apliiq is not configured.',);

    const method = opts.method ?? (opts.body ? 'POST' : 'GET');
    const bodyJson = opts.body !== undefined ? JSON.stringify(opts.body,) : null;
    const rts = Math.floor(Date.now() / 1000,).toString();
    const state = crypto.randomUUID();
    const sig = signApliiq(appId, secret, bodyJson, rts, state,);

    // The blank catalogue is ~15 MB, so the timeout is generous by default.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000,);
    try {
        const res = await fetch(`${APLIIQ_BASE_URL}${path}`, {
            method,
            headers: {
                Authorization: `x-apliiq-auth ${rts}:${sig}:${appId}:${state}`,
                Accept: 'application/json',
                ...(bodyJson ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(bodyJson ? { body: bodyJson, } : {}),
            signal: controller.signal,
        },);
        const text = await res.text();
        let json: T | null = null;
        try { json = JSON.parse(text,) as T; } catch { /* non-JSON body */ }
        return { status: res.status, json, text, };
    } finally {
        clearTimeout(timer,);
    }
}
