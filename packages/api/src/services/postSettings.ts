/**
 * Posts settings (`posts_settings` keyed row): General options, per-type
 * options, and the Live Show provider + its credentials.
 *
 * Secrets: provider fields of type `secret` are masked on read; a submitted
 * mask (the form echoing what it showed) or an empty value keeps the stored
 * secret — saving a form must never wipe live credentials.
 */
import type { LiveProviderDescriptor, PostsSettings, } from '@sitesurge/types';
import { isPostType, DEFAULT_POST_TYPE, } from '@sitesurge/types';
import { ValidationError, } from '../core/errors';
import type { AuditContext, } from './types';
import { getPostsSettingsRaw, setPostsSettingsRaw, } from './settings';
import { getLiveProvider, LIVE_PROVIDERS, } from './liveProviders/registry';

export const SECRET_MASK = '••••••••';

function normalize(raw: Partial<PostsSettings> | null | undefined,): PostsSettings {
    const r = raw ?? {};
    const def = r.general?.defaultPostType;
    return {
        general: { defaultPostType: isPostType(def,) ? def! : DEFAULT_POST_TYPE, },
        types: (r.types && typeof r.types === 'object') ? r.types : {},
        live: {
            provider: getLiveProvider(r.live?.provider,) ? r.live!.provider! : null,
            providers: (r.live?.providers && typeof r.live.providers === 'object') ? r.live.providers : {},
        },
    };
}

/** Full settings incl. secrets — server use only (provider adapters). */
export async function getPostsSettings(): Promise<PostsSettings> {
    return normalize(await getPostsSettingsRaw() as Partial<PostsSettings>,);
}

function secretKeys(p: LiveProviderDescriptor,): Set<string> {
    return new Set(p.fields.filter((f,) => f.type === 'secret').map((f,) => f.key),);
}

/** Settings as the admin sees them (secrets masked) + the provider catalogue. */
export async function getForClient(): Promise<{ settings: PostsSettings; liveProviders: LiveProviderDescriptor[]; }> {
    const s = await getPostsSettings();
    const providers: Record<string, Record<string, unknown>> = {};
    for (const [key, cfg,] of Object.entries(s.live.providers,)) {
        const p = getLiveProvider(key,);
        if (!p) continue;
        const masked = { ...cfg, };
        for (const k of secretKeys(p,)) if (masked[k]) masked[k] = SECRET_MASK;
        providers[key] = masked;
    }
    return { settings: { ...s, live: { ...s.live, providers, }, }, liveProviders: LIVE_PROVIDERS, };
}

export async function update(patch: Partial<PostsSettings>, ctx: AuditContext,): Promise<{ settings: PostsSettings; liveProviders: LiveProviderDescriptor[]; }> {
    const current = await getPostsSettings();
    const next: PostsSettings = {
        general: { ...current.general, ...(patch.general ?? {}), },
        types: { ...current.types, ...(patch.types ?? {}), },
        live: {
            provider: patch.live && 'provider' in patch.live ? patch.live.provider ?? null : current.live.provider,
            providers: { ...current.live.providers, },
        },
    };
    if (patch.general?.defaultPostType && !isPostType(patch.general.defaultPostType,)) {
        throw new ValidationError(`Unknown post type "${patch.general.defaultPostType}"`,);
    }
    if (next.live.provider && !getLiveProvider(next.live.provider,)) {
        throw new ValidationError(`Unknown live provider "${next.live.provider}"`,);
    }
    for (const [key, incoming,] of Object.entries(patch.live?.providers ?? {},)) {
        const p = getLiveProvider(key,);
        if (!p || !incoming || typeof incoming !== 'object') continue;
        const known = new Map(p.fields.map((f,) => [f.key, f,]),);
        const secrets = secretKeys(p,);
        const merged: Record<string, unknown> = { ...(current.live.providers[key] ?? {}), };
        for (const [k, v,] of Object.entries(incoming,)) {
            const field = known.get(k,);
            if (!field) continue; // unknown keys are dropped, never stored
            if (secrets.has(k,) && (v === SECRET_MASK || v === '')) continue;
            if (field.type === 'toggle') merged[k] = v === true;
            else if (field.type === 'select') {
                if (typeof v === 'string' && field.options?.some((o,) => o.value === v)) merged[k] = v;
            } else merged[k] = typeof v === 'string' ? v.trim().slice(0, 2000,) : '';
        }
        next.live.providers[key] = merged;
    }
    await setPostsSettingsRaw(next, ctx,);
    return getForClient();
}
