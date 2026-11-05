/**
 * `broker` provider — a Claude Code session attached to a claude-broker
 * daemon, reached through the `claude-broker` plugin's actions (pools, least-
 * busy session picking, prompt framing and result screening live there).
 */
import type { AiJobsQuery, AiPool, AiProviderStatus, AiQueryBody, AiResult, AiSession, } from '@sitesurge/types';
import { AppError, } from '../../../core/errors';
import * as pluginsRepo from '../../../repositories/plugins.repo';
import { dispatchAction, } from '../../plugins';
import { type BrokerJob, failedResult, fromBrokerJob, } from '../result';

export const BROKER_PLUGIN = 'claude-broker';

/** The audit actor for internal plugin calls (no per-call audit row is written). */
const SYSTEM_CTX = { userId: 'system:ai', };

type ActionResult = { ok: true; [k: string]: unknown; } | { ok: false; status?: number; error?: string; };

export async function pluginState(): Promise<{ installed: boolean; enabled: boolean; error: string | null; }> {
    const row = await pluginsRepo.getByName(BROKER_PLUGIN,).catch(() => null);
    return { installed: !!row?.installed, enabled: !!(row?.installed && row.enabled && !row.error), error: row?.error ?? null, };
}

/** Run a plugin action; a disabled/missing plugin becomes `{ ok:false }`, never a throw. */
export async function call(action: string, payload: Record<string, unknown> = {},): Promise<ActionResult> {
    const st = await pluginState();
    if (!st.enabled) {
        return { ok: false, status: 409, error: st.installed ? 'The claude-broker plugin is disabled' : 'The claude-broker plugin is not installed', };
    }
    try {
        const r = await dispatchAction(BROKER_PLUGIN, action, payload, SYSTEM_CTX, { audit: false, },) as ActionResult;
        return r && typeof r === 'object' && 'ok' in r ? r : { ok: false, error: 'Unexpected plugin response', };
    } catch (e) {
        return { ok: false, status: e instanceof AppError ? e.statusCode : 502, error: (e as Error).message, };
    }
}

/** Throw a plugin failure as an HTTP error (routes). */
export function unwrap<T,>(r: ActionResult, key: string,): T {
    if (!r.ok) throw new AppError(r.status && r.status >= 400 ? r.status : 502, 'AI_BROKER_ERROR', r.error ?? 'Broker request failed',);
    return (r as Record<string, unknown>)[key] as T;
}

export async function status(): Promise<{ provider: AiProviderStatus; raw: ActionResult; }> {
    const raw = await call('status',);
    const pools = raw.ok ? (raw.pools as AiPool[]) : [];
    const attached = pools.reduce((n, p,) => n + p.attached, 0,);
    let reason: string | null = null;
    if (!raw.ok) reason = raw.error ?? 'Broker unavailable';
    else if (!pools.length) reason = 'No pools are configured in the claude-broker plugin';
    else if (!attached) reason = 'No session is attached in any pool';
    return { provider: { key: 'broker', label: 'Claude broker (plugin)', available: !reason, reason, }, raw, };
}

export async function query(input: AiQueryBody,): Promise<AiResult> {
    const r = await call('submit', {
        prompt: input.prompt,
        system: input.system,
        pool: input.pool,
        session: input.session,
        format: input.format,
        kind: input.kind,
        meta: input.meta,
        wait: input.wait !== false,
        timeoutSec: input.timeoutSec,
    },);
    if (!r.ok) return failedResult('broker', r.error ?? 'Broker request failed', { pool: input.pool ?? null, },);
    return fromBrokerJob(r.job as BrokerJob, input.format,);
}

export async function job(id: string, waitSec?: number, format?: 'text' | 'json',): Promise<AiResult> {
    const r = waitSec ? await call('wait', { id, timeoutSec: waitSec, },) : await call('job', { id, },);
    return fromBrokerJob(unwrap<BrokerJob>(r, 'job',), format,);
}

export async function cancel(id: string,): Promise<AiResult> {
    return fromBrokerJob(unwrap<BrokerJob>(await call('cancel', { id, },), 'job',),);
}

export async function comment(id: string, note: string,): Promise<AiResult> {
    return fromBrokerJob(unwrap<BrokerJob>(await call('comment', { id, note, },), 'job',),);
}

export async function jobs(q: AiJobsQuery,): Promise<AiResult[]> {
    const list = unwrap<BrokerJob[]>(await call('jobs', { ...q, },), 'jobs',);
    return list.map((j,) => fromBrokerJob(j,));
}

export async function pools(): Promise<AiPool[]> {
    const r = await call('status',);
    if (r.ok) return r.pools as AiPool[];
    // Broker down: still list the configured pools, with zero attached.
    const cfg = await call('pools',);
    if (!cfg.ok) throw new AppError(r.status && r.status >= 400 ? r.status : 502, 'AI_BROKER_ERROR', r.error ?? 'Broker unavailable',);
    return (cfg.pools as Array<{ name: string; count: number; description: string; }>).map((p,) => ({
        name: p.name, expected: p.count, description: p.description, attached: 0, busy: 0, idle: 0, healthy: false, sessions: [],
    }));
}

export async function sessions(pool?: string, all?: boolean,): Promise<AiSession[]> {
    return unwrap<AiSession[]>(await call('sessions', { pool, all, },), 'sessions',);
}
