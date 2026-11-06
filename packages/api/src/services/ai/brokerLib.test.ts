/**
 * The claude-broker plugin's pure helpers (plugins/claude-broker/lib.js):
 * pool routing must skip sessions that cannot work, pool status must count
 * only those that can, and nothing may hand the Claude credential to a browser.
 */
import { createRequire, } from 'node:module';
import path from 'node:path';
import { describe, expect, it, } from 'vitest';

const require = createRequire(import.meta.url,);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require(path.resolve(__dirname, '../../../plugins/claude-broker/lib.js',),);

const s = (id: string, label: string, tui_state?: string,) => ({ id, label, status: 'attached', ...(tui_state ? { tui_state, } : {}), });

describe('claude-broker lib', () => {
    it('pool membership is <pool> or <pool>-<n> only', () => {
        expect(lib.inPool('summary', 'summary',),).toBe(true,);
        expect(lib.inPool('summary-2', 'summary',),).toBe(true,);
        expect(lib.inPool('summary-x', 'summary',),).toBe(false,);
        expect(lib.inPool('summary2', 'summary',),).toBe(false,);
    },);

    it('normalizePools clamps the count to 1…16 and drops bad / duplicate names', () => {
        const out = lib.normalizePools([{ name: 'a', count: 0, }, { name: 'b', count: 99, }, { name: 'a', count: 2, }, { name: 'bad name', },],);
        expect(out,).toEqual([{ name: 'a', count: 1, description: '', }, { name: 'b', count: 16, description: '', },],);
    },);

    it('poolStatus counts only sessions that can work as ready', () => {
        const [p,] = lib.poolStatus([{ name: 'gen', count: 2, description: '', },], [s('1', 'gen-1',), s('2', 'gen-2', 'usage_limited',),], [],);
        expect(p,).toMatchObject({ attached: 2, ready: 1, idle: 1, healthy: false, },);
        expect(p.sessions[1],).toMatchObject({ healthy: false, state: 'usage_limited', },);
    },);

    it('pickSession prefers the least busy member and skips none it was given', () => {
        const sessions = [s('1', 'gen-1',), s('2', 'gen-2',),];
        const busy = [{ session_id: '1', status: 'in_progress', },];
        expect(lib.pickSession('gen', sessions, busy, new Map(),).id,).toBe('2',);
        expect(lib.pickSession('other', sessions, [], new Map(),),).toBeNull();
    },);

    it('noSessionReason names the states when members are attached but unusable', () => {
        expect(lib.noSessionReason('gen', [],),).toMatch(/No session is attached/,);
        expect(lib.noSessionReason('gen', [s('1', 'gen', 'login_required',),],),).toMatch(/signed out/,);
    },);

    it('normalizeJob keeps the session label recorded in meta', () => {
        const j = lib.normalizeJob({ id: 'j', status: 'dispatched', session_id: 'x', meta: { session: 'gen-1', pool: 'gen', }, },);
        expect(j,).toMatchObject({ status: 'pending', sessionLabel: 'gen-1', pool: 'gen', },);
    },);

    it('authView never passes the token value through', () => {
        const v = lib.authView({ token: { set: true, value: 'sk-ant-oat-secret', token: 'x', created_at: '2026-11-01', }, login: { pending: false, }, claude: { installed: true, version: '2', }, },);
        expect(JSON.stringify(v,),).not.toContain('secret',);
        expect(v.token,).toEqual({ set: true, created_at: '2026-11-01', expires_at: null, },);
    },);
});
