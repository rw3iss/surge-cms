import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import type { AiStatusResponse, } from '@sitesurge/types';
import { pickSummaryTarget, } from './summary';

const pool = (name: string, attached: number,) => ({ name, expected: 1, description: '', attached, busy: 0, idle: attached, healthy: attached > 0, sessions: [], });
const status = (over: Partial<AiStatusResponse> & { pools?: ReturnType<typeof pool>[]; anthropic?: boolean; defaultPool?: string | null; reachable?: boolean; },): AiStatusResponse => ({
    defaultProvider: 'broker',
    providers: [
        { key: 'broker', label: 'Claude broker', available: true, reason: null, },
        { key: 'anthropic', label: 'Anthropic API', available: Boolean(over.anthropic), reason: null, },
    ],
    broker: { pluginInstalled: true, pluginEnabled: true, reachable: over.reachable ?? true, version: '0.6.0', sessionCount: 1, defaultPool: over.defaultPool ?? null, error: null, },
    pools: over.pools ?? [],
} as AiStatusResponse);

describe('pickSummaryTarget', () => {
    it('prefers the analytics pool when it has a session', () => {
        expect(pickSummaryTarget(status({ pools: [pool('analytics', 2,), pool('general', 1,),], defaultPool: 'general', },),),)
            .toEqual({ ok: true, opts: { provider: 'broker', pool: 'analytics', }, },);
    },);

    it('falls back to the default pool, then the Anthropic API', () => {
        expect(pickSummaryTarget(status({ pools: [pool('analytics', 0,), pool('general', 1,),], defaultPool: 'general', },),),)
            .toEqual({ ok: true, opts: { provider: 'broker', pool: 'general', }, },);
        expect(pickSummaryTarget(status({ pools: [pool('analytics', 0,),], anthropic: true, },),),)
            .toEqual({ ok: true, opts: { provider: 'anthropic', }, },);
    },);

    it('says what to do when nothing can answer', () => {
        const r = pickSummaryTarget(status({ pools: [pool('analytics', 0,),], reachable: true, },),);
        expect(r.ok,).toBe(false,);
        expect(!r.ok && r.error,).toMatch(/Start the "analytics" pool/,);
        expect(pickSummaryTarget(status({ pools: [pool('analytics', 2,),], reachable: false, },),).ok,).toBe(false,);
    },);
},);
