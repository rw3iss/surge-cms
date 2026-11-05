/**
 * claude-broker plugin — server setup helpers (plugins/claude-broker/claude.js):
 * the sign-in link parser, pool session labels, and the admin sign-in flow
 * (`claude auth login` over a FIFO), run against a fake `claude` CLI.
 */
import fs from 'node:fs';
import { createRequire, } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, } from 'vitest';

const require = createRequire(import.meta.url,);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const claude = require('../../plugins/claude-broker/claude.js',);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-setup-',),);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true, },),);

/** A stand-in for the claude CLI: prints a sign-in link, accepts the code "good#ok". */
const fake = path.join(tmp, 'claude',);
fs.writeFileSync(fake, `#!/bin/sh
STATE="${tmp}/signed-in"
case "$1 $2" in
  "--version ") echo "9.9.9 (Claude Code)";;
  "auth status") if [ -f "$STATE" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}'; else echo '{"loggedIn":false,"authMethod":"none"}'; exit 1; fi;;
  "auth login")
    printf 'Opening browser to sign in…\\nIf the browser did not open, visit: \\033]8;;https://claude.com/cai/oauth/authorize?code=true&state=abc\\007https://claude.com/cai/oauth/authorize?code=true&state=abc\\033]8;;\\007\\n'
    while true; do
      printf 'Paste code here if prompted > '
      read code || exit 1
      if [ "$code" = "good#ok" ]; then touch "$STATE"; echo "Login successful."; exit 0; fi
      echo "Invalid code. Please make sure the full code was copied."
    done;;
esac
`, { mode: 0o755, },);

const cfg = { claudePath: fake, dataDir: path.join(tmp, 'data',), pools: [], };

describe('pure helpers', () => {
    it('extracts the sign-in link from OSC-8 hyperlink output', () => {
        const out = 'visit: \x1b]8;;https://claude.com/cai/oauth/authorize?a=1&b=2\x07https://claude.com/cai/oauth/authorize?a=1&b=2\x1b]8;;\x07\n';
        expect(claude.extractLoginUrl(out,),).toBe('https://claude.com/cai/oauth/authorize?a=1&b=2',);
        expect(claude.extractLoginUrl('no link here',),).toBeNull();
    },);

    it('names a pool\'s sessions <name> (count 1) or <name>-1…<name>-N', () => {
        expect(claude.poolLabels({ name: 'summary', count: 1, },),).toEqual(['summary',],);
        expect(claude.poolLabels({ name: 'summary', count: 3, },),).toEqual(['summary-1', 'summary-2', 'summary-3',],);
        expect(claude.poolLabels({ name: 'x', count: 99, },),).toHaveLength(16,);
    },);

    it('finds the selected option line of a Claude Code prompt', () => {
        const pane = 'Loading development channels\n  1. Exit\n❯ 2. I am using this for local development\n';
        expect(claude.selectedLine(pane,),).toContain('local development',);
    },);

    it('uses its own tmux socket, never the operator\'s server', () => {
        expect(claude.TMUX_SOCKET,).toBe('sitesurge-broker',);
    },);
},);

describe('sign in from the admin (fake claude CLI)', () => {
    it('reports installed + signed out', async () => {
        const st = await claude.claudeStatus(cfg,);
        expect(st.claude,).toMatchObject({ installed: true, path: fake, version: '9.9.9 (Claude Code)', },);
        expect(st.auth.loggedIn,).toBe(false,);
    },);

    it('starts the login, keeps it waiting on a wrong code, signs in on the right one', async () => {
        const start = await claude.loginStart(cfg,);
        expect(start,).toEqual({ ok: true, url: 'https://claude.com/cai/oauth/authorize?code=true&state=abc', },);
        expect(claude.loginState(cfg,).pending,).toBe(true,);

        const bad = await claude.loginSubmit(cfg, 'nope',);
        expect(bad,).toMatchObject({ ok: false, retry: true, },);
        expect(claude.loginState(cfg,).pending,).toBe(true,);

        const good = await claude.loginSubmit(cfg, 'good#ok',);
        expect(good,).toMatchObject({ ok: true, auth: { loggedIn: true, email: 'a@b.c', }, },);
        expect(claude.loginState(cfg,).pending,).toBe(false,);
    }, 20000,);

    it('refuses a code with a newline and a submit with no login waiting', async () => {
        expect(await claude.loginSubmit(cfg, 'a\nb',),).toMatchObject({ ok: false, },);
        expect(await claude.loginSubmit(cfg, 'good#ok',),).toMatchObject({ ok: false, error: expect.stringMatching(/No sign-in is waiting/,), },);
    },);

    it('cancel kills the waiting login', async () => {
        fs.rmSync(path.join(tmp, 'signed-in',), { force: true, },);
        expect((await claude.loginStart(cfg,)).ok,).toBe(true,);
        await claude.loginCancel(cfg,);
        expect(claude.loginState(cfg,).pending,).toBe(false,);
    }, 20000,);
},);
