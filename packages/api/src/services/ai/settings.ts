/**
 * AI module settings (`ai_settings` keyed site_settings row): the default
 * provider and the Anthropic key/model. The key is masked to the client
 * (`SECRET_MASK`); an echoed mask means "unchanged". `ANTHROPIC_API_KEY`
 * (env) wins over the stored key.
 */
import type { AiProviderKey, AiSettings, AiSettingsBody, } from '@sitesurge/types';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { uuidOrNull, } from '../../utils/uuid';

export const SECRET_MASK = '••••••••';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const KEY = 'ai_settings';
const TTL_MS = 30_000;

const DEFAULTS: AiSettings = {
    defaultProvider: 'broker',
    anthropic: { apiKey: '', model: DEFAULT_ANTHROPIC_MODEL, maxTokens: 4096, },
};

let cached: { at: number; value: AiSettings; } | null = null;

/** Server use — the real key (env first). */
export async function getAiSettings(): Promise<AiSettings> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
    const r = await query<{ value: Partial<AiSettings>; }>(`SELECT value FROM site_settings WHERE key = $1`, [KEY,],)
        .catch(() => ({ rows: [] as { value: Partial<AiSettings>; }[], }));
    const row = r.rows[0]?.value ?? {};
    const value: AiSettings = {
        defaultProvider: row.defaultProvider === 'anthropic' ? 'anthropic' : 'broker',
        anthropic: { ...DEFAULTS.anthropic, ...(row.anthropic ?? {}), },
    };
    if (config.ai?.anthropicApiKey) value.anthropic.apiKey = config.ai.anthropicApiKey;
    cached = { at: Date.now(), value, };
    return value;
}

/** For the admin: the key masked. */
export async function aiSettingsForAdmin(): Promise<AiSettings> {
    const s = await getAiSettings();
    return { ...s, anthropic: { ...s.anthropic, apiKey: s.anthropic.apiKey ? SECRET_MASK : '', }, };
}

export async function setAiSettings(body: AiSettingsBody, actor: string | null,): Promise<AiSettings> {
    const cur = await getAiSettings();
    const provider: AiProviderKey = body.defaultProvider ?? cur.defaultProvider;
    if (provider !== 'broker' && provider !== 'anthropic') throw new ValidationError('Unknown AI provider.',);
    const a = body.anthropic ?? {};
    const key = a.apiKey === undefined || a.apiKey === SECRET_MASK ? cur.anthropic.apiKey : a.apiKey.trim();
    const maxTokens = a.maxTokens === undefined ? cur.anthropic.maxTokens : Math.round(Number(a.maxTokens,),);
    if (!Number.isFinite(maxTokens,) || maxTokens < 1 || maxTokens > 64000) throw new ValidationError('Max tokens: 1–64000.',);
    const next: AiSettings = {
        defaultProvider: provider,
        anthropic: {
            // Never store the env key — it would outlive a rotation of the env var.
            apiKey: config.ai?.anthropicApiKey && key === config.ai.anthropicApiKey ? '' : key,
            model: (a.model ?? cur.anthropic.model).trim() || DEFAULT_ANTHROPIC_MODEL,
            maxTokens,
        },
    };
    await query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [KEY, JSON.stringify(next,), uuidOrNull(actor,),],
    );
    cached = null;
    return aiSettingsForAdmin();
}
