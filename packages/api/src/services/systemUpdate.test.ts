/**
 * CMS version check: npm is the source of truth (it is what an update
 * installs), the GitHub Release supplies notes and stands in only when npm is
 * unreachable, and a source checkout never runs `npm install`.
 */
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
const spawn = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawn(...a), }),);

const REPO_ROOT = path.resolve(__dirname, '../../../..',);
const API_ROOT = path.resolve(__dirname, '../..',); // packages/api — not a checkout root

type Route = { npm?: string | null; release?: Record<string, unknown> | null; };
function stubFetch({ npm = '9.9.9', release = null, }: Route,) {
    vi.stubGlobal('fetch', vi.fn(async (url: string,) => {
        if (url.includes('registry.npmjs.org',)) {
            return npm ? { ok: true, json: async () => ({ version: npm, }), } : { ok: false, json: async () => ({}), };
        }
        if (url.includes('api.github.com',)) {
            return release ? { ok: true, json: async () => release, } : { ok: false, json: async () => ({}), };
        }
        throw new Error(`unexpected fetch ${url}`,);
    },),);
}

let sys: typeof import('./systemUpdate');
beforeEach(async () => {
    vi.resetModules(); // fresh release cache per test
    spawn.mockReset();
    sys = await import('./systemUpdate');
},);
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
},);

describe('getVersionInfo', () => {
    it('reports npm latest and attaches that version’s GitHub release notes', async () => {
        vi.spyOn(process, 'cwd',).mockReturnValue(API_ROOT,);
        stubFetch({
            npm: '99.0.0',
            release: { tag_name: 'v99.0.0', html_url: 'https://github.com/x/y/releases/tag/v99.0.0', body: '- a change', published_at: '2026-10-06T00:00:00Z', },
        },);
        const v = await sys.getVersionInfo();
        expect(v,).toMatchObject({ latest: '99.0.0', latestSource: 'npm', updateAvailable: true, },);
        expect(v.release,).toMatchObject({ tag: 'v99.0.0', notes: '- a change', },);
        expect((fetch as unknown as { mock: { calls: string[][]; }; }).mock.calls.some(([u,],) => u.endsWith('/releases/tags/v99.0.0',)),).toBe(true,);
    },);

    it('falls back to the latest GitHub release when npm is unreachable', async () => {
        vi.spyOn(process, 'cwd',).mockReturnValue(API_ROOT,);
        stubFetch({ npm: null, release: { tag_name: 'v99.1.0', body: '', }, },);
        const v = await sys.getVersionInfo();
        expect(v,).toMatchObject({ latest: '99.1.0', latestSource: 'github', latestUnavailable: false, },);
    },);

    it('says unavailable when neither answers', async () => {
        vi.spyOn(process, 'cwd',).mockReturnValue(API_ROOT,);
        stubFetch({ npm: null, release: null, },);
        const v = await sys.getVersionInfo();
        expect(v,).toMatchObject({ latest: null, latestSource: null, latestUnavailable: true, updateAvailable: false, },);
    },);

    it('identifies a source checkout', async () => {
        vi.spyOn(process, 'cwd',).mockReturnValue(REPO_ROOT,);
        stubFetch({ npm: '99.0.0', },);
        expect((await sys.getVersionInfo()).installKind,).toBe('source',);
    },);
},);

describe('detectSourceCheckout', () => {
    const MODULE_DIR = path.join(API_ROOT, 'dist', 'services',);
    it('is a checkout when run from the repo root', () => {
        expect(sys.detectSourceCheckout(REPO_ROOT, MODULE_DIR,),).toBe(true,);
    },);
    it('is a checkout when the cwd is packages/api (how the service runs)', () => {
        expect(sys.detectSourceCheckout(API_ROOT, MODULE_DIR,),).toBe(true,);
    },);
    it('is an npm install when the server lives under node_modules', () => {
        const npmDir = path.join(REPO_ROOT, 'node_modules', '@sitesurge', 'server', 'dist', 'services',);
        expect(sys.detectSourceCheckout('/srv/site', npmDir,),).toBe(false,);
    },);
},);

describe('runUpdate', () => {
    it('never runs npm install in a source checkout', async () => {
        vi.spyOn(process, 'cwd',).mockReturnValue(REPO_ROOT,);
        stubFetch({ npm: '99.0.0', },);
        const r = await sys.runUpdate({ userId: 'u1', } as never,);
        expect(r.ok,).toBe(false,);
        expect(r.output,).toMatch(/source checkout/,);
        expect(spawn,).not.toHaveBeenCalled();
    },);
},);
