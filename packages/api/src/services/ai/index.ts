/**
 * The CMS AI module. ONE entry point for every AI request, whichever provider
 * answers it — `broker` (the claude-broker plugin; default) or `anthropic`
 * (Messages API, optional) — and ONE answer shape, `AiResult`.
 *
 * Server code calls `ask(prompt, opts)`; the admin + SDK go through
 * /api/v1/ai (routes/ai.ts → `query`, `job`, …). Guide: docs/how-it-works/AI.md.
 */
import type { AiJobsQuery, AiPool, AiProviderKey, AiQueryBody, AiResult, AiSession, AiStatusResponse, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import * as anthropic from './providers/anthropic';
import * as broker from './providers/broker';
import { getAiSettings, } from './settings';

export { aiSettingsForAdmin, getAiSettings, setAiSettings, } from './settings';
export { isDegenerateOutput, parseJsonLoose, } from './result';

async function providerFor(requested?: AiProviderKey,): Promise<AiProviderKey> {
    if (requested) {
        if (requested !== 'broker' && requested !== 'anthropic') throw new ValidationError(`Unknown AI provider "${requested}".`,);
        return requested;
    }
    return (await getAiSettings()).defaultProvider;
}

/** Send a prompt. Waits for the answer unless `wait: false` (broker only — then poll `job(id)`). */
export async function query(input: AiQueryBody,): Promise<AiResult> {
    if (!input.prompt?.trim()) throw new ValidationError('A prompt is required.',);
    const provider = await providerFor(input.provider,);
    return provider === 'anthropic' ? anthropic.query(input,) : broker.query(input,);
}

/**
 * Server-side helper for other services (e.g. analytics summaries): ask and
 * wait. Never throws for a provider failure — check `status`/`error`.
 */
export function ask(prompt: string, opts: Omit<AiQueryBody, 'prompt'> = {},): Promise<AiResult> {
    return query({ ...opts, prompt, wait: opts.wait ?? true, },);
}

/** Ask for JSON; resolves to the parsed value, or null when the request failed. */
export async function askJson<T = unknown,>(prompt: string, opts: Omit<AiQueryBody, 'prompt' | 'format'> = {},): Promise<T | null> {
    const r = await ask(prompt, { ...opts, format: 'json', },);
    return r.status === 'completed' ? r.data as T : null;
}

function assertBrokerJobId(id: string,): void {
    if (id.startsWith('anthropic:',)) throw new NotFoundError('Job (Anthropic answers are final — there is no job)',);
}

export async function job(id: string, waitSec?: number,): Promise<AiResult> {
    assertBrokerJobId(id,);
    return broker.job(id, waitSec,);
}

export async function cancel(id: string,): Promise<AiResult> {
    assertBrokerJobId(id,);
    return broker.cancel(id,);
}

export async function comment(id: string, note: string,): Promise<AiResult> {
    assertBrokerJobId(id,);
    if (!note.trim()) throw new ValidationError('A note is required.',);
    return broker.comment(id, note,);
}

export function jobs(q: AiJobsQuery,): Promise<AiResult[]> {
    return broker.jobs(q,);
}

export function pools(): Promise<AiPool[]> {
    return broker.pools();
}

export function sessions(pool?: string, all?: boolean,): Promise<AiSession[]> {
    return broker.sessions(pool, all,);
}

export async function status(): Promise<AiStatusResponse> {
    const [settings, plugin, b, a,] = await Promise.all([getAiSettings(), broker.pluginState(), broker.status(), anthropic.status(),],);
    const raw = b.raw as Record<string, unknown>;
    const info = (raw.broker ?? {}) as { version?: string | null; sessionCount?: number; };
    return {
        defaultProvider: settings.defaultProvider,
        providers: [b.provider, a,],
        broker: {
            pluginInstalled: plugin.installed,
            pluginEnabled: plugin.enabled,
            reachable: raw.ok === true,
            version: info.version ?? null,
            sessionCount: info.sessionCount ?? 0,
            defaultPool: (raw.defaultPool as string | null | undefined) ?? null,
            error: raw.ok === true ? null : (raw.error as string | undefined) ?? null,
        },
        pools: raw.ok === true ? raw.pools as AiPool[] : [],
    };
}
