/**
 * claude-broker plugin helpers (plugins/claude-broker/lib.js): pool
 * membership, least-busy session picking, job normalisation, prompt framing.
 */
import { createRequire, } from 'node:module';
import { describe, expect, it, } from 'vitest';

const require = createRequire(import.meta.url,);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../../plugins/claude-broker/lib.js',);

const s = (id: string, label: string, status = 'attached',) => ({ id, label, status, });
const j = (session_id: string, status = 'in_progress',) => ({ session_id, status, });

describe('pool membership', () => {
    it('matches the label and its numbered members only', () => {
        expect(lib.inPool('summary', 'summary',),).toBe(true,);
        expect(lib.inPool('summary-2', 'summary',),).toBe(true,);
        expect(lib.inPool('summary-x', 'summary',),).toBe(false,);
        expect(lib.inPool('summary2', 'summary',),).toBe(false,);
        expect(lib.inPool('bills-1', 'summary',),).toBe(false,);
        expect(lib.inPool('a.b-1', 'a.b',),).toBe(true,);
        expect(lib.inPool('axb', 'a.b',),).toBe(false,);
    },);

    it('normalizes pools: drops unnamed / invalid / duplicate rows, count ≥ 1', () => {
        expect(lib.normalizePools([{ name: ' summary ', count: '3', }, { name: '', }, { name: 'bad name', }, { name: 'summary', count: 9, }, { name: 'x', count: 0, },],),)
            .toEqual([{ name: 'summary', count: 3, description: '', }, { name: 'x', count: 1, description: '', },],);
        expect(lib.normalizePools('nope',),).toEqual([],);
    },);
},);

describe('pickSession', () => {
    const sessions = [s('a', 'summary-1',), s('b', 'summary-2',), s('c', 'summary-3', 'detached',), s('d', 'bills',),];

    it('picks the least-busy attached member', () => {
        expect(lib.pickSession('summary', sessions, [j('a',), j('a', 'pending',), j('b',),],).id,).toBe('b',);
        expect(lib.pickSession('summary', sessions, [j('b', 'dispatched',),],).id,).toBe('a',);
    },);

    it('ignores finished jobs and detached sessions', () => {
        expect(lib.pickSession('summary', sessions, [j('a', 'completed',), j('b',),],).id,).toBe('a',);
        expect(lib.pickSession('summary', [s('c', 'summary', 'detached',),], [],),).toBeNull();
    },);

    it('breaks ties by the session that settled longest ago', () => {
        const settled = new Map([['a', 2000,], ['b', 1000,],],);
        expect(lib.pickSession('summary', sessions, [], settled,).id,).toBe('b',);
    },);

    it('reports pool status: attached vs expected, busy, idle', () => {
        const [st,] = lib.poolStatus([{ name: 'summary', count: 3, description: '', },], sessions, [j('a',),],);
        expect(st,).toMatchObject({ name: 'summary', expected: 3, attached: 2, busy: 1, idle: 1, healthy: false, },);
    },);
},);

describe('normalizeJob', () => {
    it('maps statuses and unwraps the result text', () => {
        const n = lib.normalizeJob({ id: 'j1', session_id: 'a', status: 'completed', result: { text: 'hi', }, meta: { pool: 'summary', }, },);
        expect(n,).toMatchObject({ id: 'j1', status: 'completed', text: 'hi', pool: 'summary', sessionId: 'a', },);
        expect(lib.normalizeJob({ id: 'j2', status: 'dispatched', },).status,).toBe('pending',);
        expect(lib.normalizeJob({ id: 'j3', status: 'orphaned', },).status,).toBe('failed',);
        expect(lib.normalizeJob({ job_id: 'j4', job: { id: 'j4', status: 'pending', }, },).id,).toBe('j4',);
    },);

    it('fails a degenerate (looping) answer', () => {
        const n = lib.normalizeJob({ id: 'j', status: 'completed', result: Array(40,).fill('court',).join(' ',), },);
        expect(n.status,).toBe('failed',);
        expect(n.degenerate,).toBe(true,);
        expect(n.text,).toBe('',);
    },);

    it('reads the broker error body', () => {
        expect(lib.brokerError({ ok: false, status: 404, error: '[object Object]', details: { error: { code: 'not_found', message: 'session not found', }, }, },),)
            .toBe('session not found (not_found)',);
        expect(lib.brokerError({ ok: false, status: 401, error: '', },),).toMatch(/token/,);
    },);
},);

describe('framePrompt', () => {
    it('adds the header and the complete_job footer', () => {
        const out = lib.framePrompt({ prompt: 'Summarize\n  this', kind: 'summary', format: 'json', },);
        expect(out.startsWith('▶ SUMMARY\nSummarize this\n\n',),).toBe(true,);
        expect(out,).toContain('Return ONLY valid JSON',);
        expect(out,).toContain('complete_job',);
    },);

    it('sends the bare prompt when framing is off', () => {
        expect(lib.framePrompt({ prompt: 'hi', system: 'Be brief.', frame: false, },),).toBe('Be brief.\n\nhi',);
    },);
},);

describe('broker ≥ 0.6: health, fleet', () => {
    it('treats sessions in a stopped TUI state as unusable, unknown as usable', () => {
        expect(lib.isHealthy({ tui_state: 'usage_limited', },),).toBe(false,);
        expect(lib.isHealthy({ tui_state: 'channels_unavailable', },),).toBe(false,);
        expect(lib.isHealthy({ tui_state: 'ready', },),).toBe(true,);
        expect(lib.isHealthy({},),).toBe(true,);
    },);

    it('needs both fleet and auth to manage sessions', () => {
        expect(lib.supportsFleet(['pools', 'fleet', 'auth', 'tui',],),).toBe(true,);
        expect(lib.supportsFleet(['pools',],),).toBe(false,);
        expect(lib.supportsFleet(undefined,),).toBe(false,);
    },);

    it('turns the plugin pools into a fleet spec (count clamped, model/effort only when set)', () => {
        expect(lib.fleetSpec({ pools: [{ name: 'summary', count: 40, }, { name: 'chat', count: 0, },], model: 'haiku', effort: '', },),).toEqual({
            pools: [{ name: 'summary', count: 16, }, { name: 'chat', count: 1, },], autostart: true, nudge: true, model: 'haiku',
        },);
    },);

    it('groups fleet sessions by pool with a readable state', () => {
        const v = lib.fleetView({
            sessions: [
                { label: 'summary-1', pool: 'summary', window: '1', attached: true, tui_state: 'ready', },
                { label: 'summary-2', pool: 'summary', window: '2', attached: true, tui_state: 'usage_limited', tui_detail: 'What do you want to do?', },
            ],
        }, [{ name: 'summary', }, { name: 'chat', },],);
        const summary = v.pools.find((p: { name: string; },) => p.name === 'summary',);
        expect(summary.sessions.map((x: { healthy: boolean; },) => x.healthy,),).toEqual([true, false,],);
        expect(summary.sessions[1].stateText,).toMatch(/usage limit/,);
        expect(v.pools.find((p: { name: string; },) => p.name === 'chat',).sessions,).toEqual([],);
    },);

    it('never picks an unhealthy pool member', () => {
        const sessions = [s('a', 'summary-1',), { ...s('b', 'summary-2',), tui_state: 'login_required', },];
        const picked = lib.pickSession('summary', sessions.filter(lib.isHealthy,), [j('a',), j('a',),], new Map(),);
        expect(picked.id,).toBe('a',);
    },);
},);
