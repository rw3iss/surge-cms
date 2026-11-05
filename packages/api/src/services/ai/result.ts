/**
 * The ONE answer shape (`AiResult`) every provider returns, plus the
 * text helpers shared by providers: loose JSON parsing (code fences,
 * surrounding prose) and a repetition-loop detector. Pure — unit-tested.
 */
import type { AiProviderKey, AiResult, AiResultStatus, } from '@sitesurge/types';

const STATUSES: AiResultStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled', 'expired',];

/** Map any provider status onto ours (broker: dispatched → pending, orphaned → failed). */
export function normalizeStatus(raw: unknown,): AiResultStatus {
    const s = String(raw ?? '',);
    if (s === 'dispatched') return 'pending';
    if (s === 'orphaned') return 'failed';
    return (STATUSES as string[]).includes(s,) ? s as AiResultStatus : 'pending';
}

export function isFinal(status: AiResultStatus,): boolean {
    return status !== 'pending' && status !== 'in_progress';
}

/** JSON from model output: plain, fenced (```json), or embedded in prose. Null when none. */
export function parseJsonLoose(raw: unknown,): unknown {
    if (raw && typeof raw === 'object') return raw;
    const s = String(raw ?? '',).trim().replace(/^```(?:json)?\s*/i, '',).replace(/```\s*$/, '',).trim();
    if (!s) return null;
    try {
        return JSON.parse(s,);
    } catch { /* fall through */ }
    for (const [open, close,] of [['{', '}',], ['[', ']',],] as const) {
        const a = s.indexOf(open,);
        const b = s.lastIndexOf(close,);
        if (a >= 0 && b > a) {
            try {
                return JSON.parse(s.slice(a, b + 1,),);
            } catch { /* next */ }
        }
    }
    return null;
}

/** A repetition loop ("court court court…") a long-running session can emit. Short outputs pass. */
export function isDegenerateOutput(text: string,): boolean {
    const t = (text ?? '').trim();
    if (t.length < 40) return false;
    const tokens = t.split(/\s+/,);
    if (tokens.length >= 20) {
        if (new Set(tokens,).size / tokens.length < 0.15) return true;
        let run = 1;
        let maxRun = 1;
        for (let i = 1; i < tokens.length; i++) {
            run = tokens[i] === tokens[i - 1] ? run + 1 : 1;
            if (run > maxRun) maxRun = run;
        }
        if (maxRun >= 10) return true;
    }
    return t.length > 300 && new Set(t.replace(/\s/g, '',),).size <= 5;
}

/** The plugin's normalised job (plugins/claude-broker/lib.js normalizeJob). */
export interface BrokerJob {
    id: string;
    status: string;
    sessionId: string | null;
    sessionLabel?: string | null;
    pool: string | null;
    text: string;
    result: unknown;
    error: string | null;
    progress?: Array<{ note: string; at: string | null; }>;
    meta?: Record<string, string>;
    createdAt: string | null;
    completedAt: string | null;
    timedOut?: boolean;
}

/** Broker job → AiResult. `format: 'json'` (or an object result) fills `data`. */
export function fromBrokerJob(job: BrokerJob, format?: 'text' | 'json',): AiResult {
    const status = normalizeStatus(job.status,);
    const done = status === 'completed';
    const wantJson = format === 'json' || job.meta?.format === 'json';
    let data: unknown = null;
    if (done) {
        if (job.result && typeof job.result === 'object') data = job.result;
        else if (wantJson) data = parseJsonLoose(job.text,);
    }
    const jsonMissing = done && wantJson && data === null;
    return {
        id: String(job.id ?? '',),
        provider: 'broker',
        status: jsonMissing ? 'failed' : status,
        text: done ? job.text ?? '' : '',
        data,
        error: jsonMissing ? 'The answer was not valid JSON' : job.error ?? null,
        pool: job.pool ?? job.meta?.pool ?? null,
        sessionId: job.sessionId ?? null,
        model: job.sessionLabel ?? null,
        timedOut: job.timedOut === true && !isFinal(status,),
        progress: Array.isArray(job.progress,) ? job.progress : [],
        meta: job.meta ?? {},
        createdAt: job.createdAt ?? null,
        completedAt: job.completedAt ?? null,
    };
}

/** A failed result for errors that happen before a job exists. */
export function failedResult(provider: AiProviderKey, error: string, extra: Partial<AiResult> = {},): AiResult {
    return {
        id: '',
        provider,
        status: 'failed',
        text: '',
        data: null,
        error,
        pool: null,
        sessionId: null,
        model: null,
        timedOut: false,
        progress: [],
        meta: {},
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        ...extra,
    };
}
