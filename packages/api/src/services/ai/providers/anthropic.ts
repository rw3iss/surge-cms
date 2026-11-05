/**
 * `anthropic` provider — the Anthropic Messages API (optional; an API key in
 * Settings → AI or ANTHROPIC_API_KEY). Synchronous: the result is final when
 * returned, so there are no jobs to poll.
 */
import type { AiProviderStatus, AiQueryBody, AiResult, } from '@sitesurge/types';
import { getAiSettings, } from '../settings';
import { failedResult, parseJsonLoose, } from '../result';

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

export async function status(): Promise<AiProviderStatus> {
    const s = await getAiSettings();
    const ok = !!s.anthropic.apiKey;
    return { key: 'anthropic', label: 'Anthropic API', available: ok, reason: ok ? null : 'No Anthropic API key is set', };
}

export async function query(input: AiQueryBody,): Promise<AiResult> {
    const s = await getAiSettings();
    const model = input.model?.trim() || s.anthropic.model;
    if (!s.anthropic.apiKey) return failedResult('anthropic', 'No Anthropic API key is set (Settings → AI).', { model, },);
    const createdAt = new Date().toISOString();
    const system = [input.system?.trim(), input.format === 'json' ? 'Return ONLY valid JSON — no prose, no code fences.' : '',]
        .filter(Boolean,).join('\n\n',);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.max(5, Math.min(input.timeoutSec ?? 300, 3600,),) * 1000,);
    try {
        const res = await fetch(API, {
            method: 'POST',
            signal: ac.signal,
            headers: { 'content-type': 'application/json', 'x-api-key': s.anthropic.apiKey, 'anthropic-version': VERSION, },
            body: JSON.stringify({
                model,
                max_tokens: input.maxTokens ?? s.anthropic.maxTokens,
                ...(system ? { system, } : {}),
                messages: [{ role: 'user', content: input.prompt, },],
            },),
        },);
        const body = await res.json().catch(() => ({})) as {
            id?: string;
            content?: Array<{ type: string; text?: string; }>;
            usage?: { input_tokens?: number; output_tokens?: number; };
            stop_reason?: string;
            error?: { message?: string; };
        };
        if (!res.ok) return failedResult('anthropic', body.error?.message || `Anthropic API error (${res.status})`, { model, createdAt, },);
        const text = (body.content ?? []).filter((b,) => b.type === 'text',).map((b,) => b.text ?? '',).join('',);
        const data = input.format === 'json' ? parseJsonLoose(text,) : null;
        const jsonMissing = input.format === 'json' && data === null;
        return {
            id: `anthropic:${body.id ?? ''}`,
            provider: 'anthropic',
            status: jsonMissing ? 'failed' : 'completed',
            text,
            data,
            error: jsonMissing ? 'The answer was not valid JSON' : (body.stop_reason === 'max_tokens' ? 'Stopped at the max-token limit' : null),
            pool: null,
            sessionId: null,
            model,
            timedOut: false,
            progress: [],
            meta: input.meta ?? {},
            createdAt,
            completedAt: new Date().toISOString(),
            usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, },
        };
    } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        return failedResult('anthropic', aborted ? 'The Anthropic request timed out' : (e as Error).message, { model, createdAt, },);
    } finally {
        clearTimeout(timer,);
    }
}
