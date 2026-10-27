/**
 * Partner settings shared by every paid program (`partner_settings` row):
 * the signing secret of the Stripe webhook endpoint that listens to events on
 * CONNECTED accounts (`account.updated`). Read through a short cache and
 * handed to the Stripe webhook verifier.
 */
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';
import { setExtraWebhookSecret, } from '../payment/credentials';

export const PARTNER_SETTINGS_KEY = 'partner_settings';
export const SECRET_MASK = '••••••••';

export interface PartnerSettings { connectWebhookSecret: string; }

let cache: { at: number; value: PartnerSettings; } | null = null;

export async function getPartnerSettings(): Promise<PartnerSettings> {
    if (cache && Date.now() - cache.at < 30_000) return cache.value;
    const r = await query<{ value: Partial<PartnerSettings>; }>(`SELECT value FROM site_settings WHERE key = $1`, [PARTNER_SETTINGS_KEY,],)
        .catch(() => ({ rows: [], }),);
    const value: PartnerSettings = { connectWebhookSecret: r.rows[0]?.value?.connectWebhookSecret ?? '', };
    cache = { at: Date.now(), value, };
    setExtraWebhookSecret('partners-connect', value.connectWebhookSecret,);
    return value;
}

/** The secret masked, for the admin. */
export async function maskedConnectSecret(): Promise<string> {
    return (await getPartnerSettings()).connectWebhookSecret ? SECRET_MASK : '';
}

/** Set the Connect webhook secret: the mask = unchanged, '' = clear. */
export async function setConnectWebhookSecret(v: string | undefined, actor: string | null,): Promise<void> {
    if (v === undefined || v === SECRET_MASK) return;
    const secret = v.trim();
    if (secret && !secret.startsWith('whsec_',)) throw new ValidationError('The signing secret starts with whsec_.',);
    await query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [PARTNER_SETTINGS_KEY, JSON.stringify({ connectWebhookSecret: secret, },), uuidOrNull(actor,),],
    );
    cache = null;
    setExtraWebhookSecret('partners-connect', secret,);
}
