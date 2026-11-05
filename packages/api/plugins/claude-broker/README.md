# claude-broker plugin

Connects the CMS AI module (`services/ai/`, `/api/v1/ai`, SDK `cms.ai`) to a
[claude-broker](https://github.com/rw3iss/claude-broker) daemon, so AI prompts
run on Claude Code sessions you already host — no per-token API cost.

## Setup

In-admin guide: **/admin/help/claude-broker**.

1. **Server, once** (SSH, as the user the CMS runs as):
   `bash packages/api/plugins/claude-broker/setup/setup-server.sh` — installs
   tmux, Claude Code and claude-broker, runs the daemon as a systemd **user**
   service (with linger) and prints the broker token. Idempotent.
2. Admin → Plugins → **Claude Broker (AI)** → Install → Enable → Configure:
   - **Broker connection** — URL (default `http://127.0.0.1:4180`) + the token.
   - **Setup → Sign in to Claude** — the server runs `claude auth login`
     DETACHED with stdin on a FIFO (`<dataDir>/login/`), so the admin opens the
     printed link, signs in, and pastes the code back (`loginStart` →
     `loginSubmit`; works across cluster workers). A wrong code keeps the login
     waiting (`retry: true`).
   - **Pools** — one row per pool: name, expected session count, description.
   - **Setup → Start sessions** — one tmux window per missing pool member on a
     PRIVATE tmux server (`tmux -L sitesurge-broker`, `$TMUX` dropped — never
     the operator's own sessions), each loading a per-session MCP config
     (`<dataDir>/mcp/<label>.json`, `--strict-mcp-config`: shim + label + token),
     so no `claude mcp add` is needed. First-run prompts (trust folder, bypass
     permissions, development channel) are answered automatically; each label's
     outcome is shown in the checklist (`<dataDir>/session-notes/`).
3. Settings → AI → Default provider = Claude broker.

**Known blocker:** Claude Code may start but print *"Channels are not currently
available"* — its channels feature is switched off for that account/version, so
the session attaches (the shim is an MCP server) but never receives a job. The
checklist reports it per session ("refused the broker channel"). Seen on Claude
Code 2.1.309 on 2026-11-05 for every newly started session.

## Pools

The broker itself has no pools. A **pool is a session label**: its members are
the attached sessions labelled `<pool>` or `<pool>-<n>` (`summary`,
`summary-1`, `summary-2` …). A request to a pool goes to the member with the
fewest active jobs (ties: the one whose last job settled longest ago), sent by
session id. `count` is how many sessions you expect; the status shows
`attached/expected` and flags a short pool.

## Prompt framing and results (CivicGate conventions)

- Each prompt gets a header (`▶ KIND` + a one-line subject) and a footer telling
  the session to answer through `complete_job` — without it a session may answer
  in chat and the job expires at its TTL. Turn off with **Frame prompts**.
- `format: 'json'` adds "Return ONLY valid JSON"; the AI module parses the
  answer loosely (code fences, surrounding prose).
- A repeating, looping answer is treated as failed and retried once (when the
  caller waits).
- Jobs to one session are spaced by **Gap between jobs** (default 6 s): a job
  sent while the session's previous turn is still open arrives inside a tool
  result and is refused.

## Actions

`POST /api/v1/plugins/claude-broker/action/<name>` (admin) — the AI module calls
the same actions internally. Each returns `{ ok: true, … }` or
`{ ok: false, status, error }`.

| Action | Payload | Returns |
|---|---|---|
| `testConnection` | – | `version`, `sessionCount` |
| `status` | – | `broker`, `pools[]` (attached/expected/busy/idle/sessions), `unpooled[]`, `defaultPool` |
| `pools` | – | configured `pools[]`, `defaultPool` |
| `sessions` | `pool?`, `all?` | `sessions[]` |
| `submit` | `prompt`, `system?`, `pool?` \| `session?` (id or label), `format?`, `kind?`, `subject?`, `wait?`, `timeoutSec?`, `ttlSec?`, `priority?`, `meta?`, `clientRef?`, `frame?` | `job` |
| `job` / `wait` | `id` (+ `timeoutSec`) | `job` |
| `cancel` | `id` | `job` |
| `comment` | `id`, `note` | `job` |
| `jobs` | `status?`, `pool?`, `sessionId?`, `limit?`, `all?` | `jobs[]` (CMS jobs unless `all`) |
| `setupStatus` | – | `claude` (installed/path/version), `auth` (loggedIn/email/subscription), `tmux`, `brokerCli`, `broker` (reachable/error), `pools[].labels[]` (attached/running/note), `login` (pending/url), `tmuxAttach` |
| `loginStart` | – | `url` (the Claude sign-in page) |
| `loginSubmit` | `code` | `auth` — or `retry: true` on a wrong code |
| `loginCancel` | – | – |
| `startSessions` | `pool?` | `started[]`, `skipped[]` |
| `stopSessions` | `labels?` | `stopped[]` |

A `job` is `{ id, status, sessionId, sessionLabel, pool, text, result, error,
progress[], meta, createdAt, dispatchedAt, completedAt, expiresAt, timedOut }`.

Pure helpers (pool membership, session picking, framing, normalisation) live in
`lib.js` and are tested by `src/plugins/claudeBroker.test.ts`; the server
setup helpers (sign-in, tmux sessions) live in `claude.js`, tested by
`src/plugins/claudeBrokerSetup.test.ts` against a fake `claude` CLI.
