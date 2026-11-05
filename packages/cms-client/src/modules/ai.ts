import type {
    AiJobsQuery,
    AiPool,
    AiQueryBody,
    AiResult,
    AiSession,
    AiSettings,
    AiSettingsBody,
    AiStatusResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /ai — the CMS AI module (staff + `ai:use`). Prompts go to the claude-broker
 * plugin (session POOLS) or the Anthropic API; every answer is an `AiResult`.
 * Reads are never cached — pools and jobs change by the second.
 */
export class AiModule extends ModuleBase {
    protected readonly module = 'ai';
    private readonly fresh = { cache: false, } as const;

    /** Providers, broker plugin state, and every pool's live status. */
    status(): Promise<AiStatusResponse> {
        return this.get('/ai/status', { options: this.fresh, },);
    }

    /** Broker pools: expected vs attached / busy / idle sessions. */
    pools(): Promise<AiPool[]> {
        return this.get('/ai/pools', { options: this.fresh, },);
    }

    /** Broker sessions (attached unless `all`), optionally one pool's. */
    sessions(query: { pool?: string; all?: boolean; } = {},): Promise<AiSession[]> {
        return this.get('/ai/sessions', { query, options: this.fresh, },);
    }

    /** Send a prompt. Waits (≤ 55 s over HTTP) unless `wait: false`; a running job comes back `timedOut` — poll `job(id, { wait })`. */
    query(body: AiQueryBody,): Promise<AiResult> {
        return this.mutate('POST', '/ai/query', { body, },);
    }

    /** Shorthand: `query({ prompt, ...opts })`. */
    ask(prompt: string, opts: Omit<AiQueryBody, 'prompt'> = {},): Promise<AiResult> {
        return this.query({ ...opts, prompt, },);
    }

    /** Recent broker jobs sent by the CMS. */
    jobs(query: AiJobsQuery = {},): Promise<AiResult[]> {
        return this.get('/ai/jobs', { query: { ...query, }, options: this.fresh, },);
    }

    /** One job; `wait` (seconds) long-polls until it settles. */
    job(id: string, opts: { wait?: number; } = {},): Promise<AiResult> {
        return this.get('/ai/jobs/:id', { params: { id, }, query: opts.wait ? { wait: opts.wait, } : undefined, options: this.fresh, },);
    }

    /** Cancel a broker job. */
    cancel(id: string,): Promise<AiResult> {
        return this.mutate('DELETE', '/ai/jobs/:id', { params: { id, }, },);
    }

    /** Add a note to a running broker job. */
    comment(id: string, note: string,): Promise<AiResult> {
        return this.mutate('POST', '/ai/jobs/:id/comment', { params: { id, }, body: { note, }, },);
    }

    /** AI settings (Anthropic key masked). `ai:manage`. */
    settings(): Promise<AiSettings> {
        return this.get('/ai/settings', { options: this.fresh, },);
    }

    /** Update the default provider / Anthropic key + model. `ai:manage`. */
    updateSettings(body: AiSettingsBody,): Promise<AiSettings> {
        return this.mutate('PUT', '/ai/settings', { body, invalidates: ['ai',], },);
    }
}
